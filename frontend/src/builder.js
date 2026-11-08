// Helpers for the staged project builder (plain JavaScript, no React).
// Idea: read or plan the folder structure first, create it, then let the AI write the files in small batches.

const BINARY = /\.(ico|png|jpe?g|gif|webp|bmp|pdf|woff2?|ttf|mp3|mp4)$/i;
export const isBinaryPath = (p) => BINARY.test(p);

// keeps only safe relative paths: no "..", no drive letters, no absolute paths
export function cleanPath(p) {
  const x = String(p).trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!x || x.startsWith('/') || /^[a-zA-Z]:/.test(x)) return null;
  if (x.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return null;
  if (/[<>:"|?*]/.test(x)) return null;
  return x;
}

// all parent folders of the files (plus any extra folders), shortest first
export function dirsOfFiles(files, extraDirs = []) {
  const dirs = new Set(extraDirs);
  files.forEach((f) => {
    const parts = f.split('/');
    for (let k = 1; k < parts.length; k++) dirs.add(parts.slice(0, k).join('/'));
  });
  return [...dirs].sort((a, b) => a.length - b.length);
}

// ---------- 1. read a folder tree written in the user's message ----------
// understands lines like  "├── server/"  and  "│   └── db.js"
export function parseTree(text) {
  const lines = String(text || '').split('\n').map((l) => l.replace(/\r$/, ''));
  const entries = [];
  let rootName = '';
  let started = false;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([│|\s]*)(?:├──|└──|\|--|\+--|`--)\s*(\S.*?)\s*$/);
    if (m) {
      if (!started) {
        started = true;
        // the line just above the first branch may be the root folder, for example "SkillSwap/"
        for (let j = i - 1; j >= 0; j--) {
          const t = lines[j].trim();
          if (!t) continue;
          const r = t.match(/^([\w.\- ]+)\/$/);
          if (r) rootName = r[1].trim();
          break;
        }
      }
      entries.push({ prefixLen: m[1].length, name: m[2].replace(/\s+(?:#|\/\/|<--|←).*$/, '') });
    } else if (started) {
      const t = lines[i].trim();
      if (t === '' || /^[│|]+$/.test(t)) continue; // spacer lines inside the tree
      break; // the tree is over
    }
  }
  if (entries.length < 6) return null;

  const positive = entries.map((e) => e.prefixLen).filter((n) => n > 0);
  const unit = positive.length ? Math.min(...positive) : 4;
  const depths = entries.map((e) => Math.round(e.prefixLen / unit));

  const stack = [];
  const dirList = [];
  const files = [];
  entries.forEach((e, i) => {
    const name = e.name.replace(/\/+$/, '');
    const depth = depths[i];
    stack.length = Math.min(stack.length, depth);
    while (stack.length < depth) stack.push('');
    stack[depth] = name;
    const path = cleanPath(stack.slice(0, depth + 1).filter(Boolean).join('/'));
    if (!path) return;
    const isDir = e.name.endsWith('/') || (i + 1 < entries.length && depths[i + 1] > depth);
    if (isDir) dirList.push(path);
    else files.push(path);
  });
  if (files.length < 1) return null;
  return { root: rootName, files: [...new Set(files)], dirs: dirsOfFiles(files, dirList) };
}

// the user's message without the tree (the file list is sent separately)
export function stripTree(text) {
  const out = [];
  let inTree = false;
  for (const line of String(text || '').split('\n')) {
    const isBranch = /^([│|\s]*)(?:├──|└──|\|--|\+--|`--)\s*\S/.test(line);
    const t = line.trim();
    if (isBranch) { inTree = true; continue; }
    if (inTree && (t === '' || /^[│|]+$/.test(t))) continue;
    inTree = false;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

export const trimRequirements = (text) => stripTree(text).trim().slice(0, 8000);

// ---------- 2. order and group the files ----------
// configuration first, then backend (models before controllers before routes), then frontend
const ORDER_RULES = [
  [/^(package\.json|\.gitignore)$/, 0],
  [/(^|\/)\.env(\.example)?$/, 1],
  [/^(server|backend)\/package\.json$/, 2],
  [/^(server|backend)\/(.*\/)?(config|db)\//, 10],
  [/^(server|backend)\/(.*\/)?models?\//, 11],
  [/^(server|backend)\/(.*\/)?utils?\//, 12],
  [/^(server|backend)\/(.*\/)?middleware\//, 13],
  [/^(server|backend)\/(.*\/)?controllers?\//, 14],
  [/^(server|backend)\/(.*\/)?routes?\//, 15],
  [/^(server|backend)\/(server|index|app)\.(js|ts)$/, 16],
  [/^(server|backend)\//, 17],
  [/^(client|frontend)\/(package\.json|vite\.config\.\w+|index\.html)$/, 20],
  [/^(client|frontend)\/.*services?\//, 21],
  [/^(client|frontend)\/.*context\//, 22],
  [/^(client|frontend)\/.*hooks?\//, 23],
  [/^(client|frontend)\/.*utils?\//, 24],
  [/^(client|frontend)\/.*(styles|css)\b/, 25],
  [/^(client|frontend)\/.*components?\//, 26],
  [/^(client|frontend)\/.*pages?\//, 27],
  [/^(client|frontend)\//, 28],
  [/^readme/, 40],
];

export function orderFiles(files) {
  const rank = (p) => {
    const lp = p.toLowerCase();
    for (const [re, n] of ORDER_RULES) if (re.test(lp)) return n;
    return 30;
  };
  return [...files].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

// big files (pages, controllers) count more, so a batch never gets too large for one answer
const weightOf = (p) => {
  if (/(pages?|controllers?)\//i.test(p) || /(^|\/)App\.jsx$/.test(p)) return 3;
  if (/(models?|routes?|services?|components?|context|hooks?|middleware)\//i.test(p)) return 2;
  return 1;
};

export function makeBatches(paths, capacity = 6) {
  const batches = [];
  let cur = [];
  let w = 0;
  for (const p of paths) {
    const x = weightOf(p);
    if (cur.length && w + x > capacity) { batches.push(cur); cur = []; w = 0; }
    cur.push(p);
    w += x;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

// ---------- 3. short summaries of written files (so later files use the same names) ----------
export function summarize(path, content) {
  const keep = [];
  for (const line of String(content).split('\n')) {
    if (/^\s*(import\s|export\s|module\.exports|exports\.|const\s+\w+\s*=\s*require\(|router\.(get|post|put|patch|delete|use)\(|app\.(use|get|post|put|delete)\(|mongoose\.model\(|new\s+(mongoose\.)?Schema\(|\w+\s*:\s*\{?\s*type\s*:)/.test(line)) {
      keep.push('  ' + line.trim().slice(0, 140));
      if (keep.length >= 25) break;
    }
  }
  return `${path}\n${keep.join('\n')}`;
}

export function summariesText(map) {
  const core = /(models?|utils?|middleware|config|services?|context|hooks?)\//i;
  const all = [...map.entries()];
  const ordered = [...all.filter(([p]) => core.test(p)), ...all.filter(([p]) => !core.test(p))];
  let out = '';
  for (const [, s] of ordered) {
    if (out.length + s.length > 5000) break;
    out += s + '\n';
  }
  return out || '(none yet)';
}

// ---------- 4. prompts ----------
export const BUILD_SYSTEM = `You are a senior full-stack developer. A project is built in stages: now you write ONE batch of its files.
Reply with ONLY the requested files. Write each file as a line "FILE: relative/path" followed by a code block with the COMPLETE content of that file. No explanations before, between or after the files.
Rules:
- Write exactly the files listed under WRITE NOW, with exactly those paths.
- Complete, working code. No placeholders, no "...", no TODO stubs, no "rest of the code".
- Follow the requirements, the folder structure and the technology stack of the project.
- Use the same names, routes, field names and imports as in the summaries of the files already written. Every relative import must point to a file that exists in the folder structure, with the correct path and file extension. Never import a file that is not in the structure.
- Every package you import must be listed in the dependencies of the package.json in that folder. In package.json files use these versions for common packages: react ^18.3.1, react-dom ^18.3.1, react-router-dom ^6.26.0, axios ^1.7.0, react-icons ^5.3.0, vite ^5.4.0, @vitejs/plugin-react ^4.3.1, express ^4.19.2, cors ^2.8.5, dotenv ^16.4.5, mongoose ^8.5.0, jsonwebtoken ^9.0.2, bcryptjs ^2.4.3, nodemon ^3.1.0, concurrently ^8.2.2.
- The server uses CommonJS (require, module.exports) unless the requirements say otherwise. The website (React with Vite) uses ES modules (import, export). A Vite website needs the scripts dev (vite), build (vite build) and preview, an index.html with a script tag pointing to /src/main.jsx, and a vite.config.js that uses @vitejs/plugin-react.
- The server must enable CORS, use express.json(), read its port from process.env.PORT with a default, and print "Server running on http://localhost:PORT" when it starts. The website reads the API address from import.meta.env.VITE_API_URL (with a default) in one central file.
- Never put real secrets in files: use placeholders such as your_secret_key in .env files.
- Inside markdown files, write code samples with ~~~ instead of three backticks.
- A .gitignore must list node_modules, .env and .ide-builder.json.`;

export function buildUserPrompt({ requirements, allPaths, summaries, batch }) {
  return [
    'REQUIREMENTS (from the user):', requirements, '',
    'FOLDER STRUCTURE (every file of the project):', allPaths.join('\n'), '',
    'ALREADY WRITTEN (short summaries of their imports, exports and routes):', summaries, '',
    'WRITE NOW (exactly these files):', batch.join('\n'),
  ].join('\n');
}

export const PLAN_SYSTEM = `You plan the folder structure of a software project. Reply with ONLY a JSON object, no markdown and no other text, in exactly this shape:
{"root":"ProjectName","files":["package.json","server/server.js","client/src/App.jsx"]}
Rules: list every FILE of the finished project (not folders), with relative paths and forward slashes. At most 70 files. No binary files (no images, no icons). Always include the package.json files, README.md, .gitignore and .env.example. If the request names a technology stack or a folder layout, follow it exactly. If it names none and asks for a frontend and a backend, use this layout: a client/ folder (React with Vite) and a server/ folder (Express), each with its own package.json, plus a root package.json whose scripts start both together. "root" is a short name for the project folder, without spaces.`;

export function parsePlan(text) {
  const cleaned = String(text).replace(/```json|```/gi, '');
  const s = cleaned.indexOf('{');
  const e = cleaned.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  let o;
  try { o = JSON.parse(cleaned.slice(s, e + 1)); } catch { return null; }
  if (!o || !Array.isArray(o.files)) return null;
  const files = [...new Set(o.files.map((p) => cleanPath(p)).filter(Boolean).filter((p) => !isBinaryPath(p)))].slice(0, 80);
  if (files.length < 2) return null;
  const root = /^[\w.\- ]+$/.test(String(o.root || '')) ? String(o.root).trim() : '';
  return { root, files, dirs: dirsOfFiles(files) };
}

// ---------- 5. read the files out of an answer ----------
export function parseBlocks(reply, wanted) {
  const re = /^[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*)?FILE:[ \t]*`?([^\n`*]+?)`?(?:\*\*)?[ \t]*\n+```[^\n]*\n([\s\S]*?)\n```/gm;
  const found = new Map();
  let m;
  while ((m = re.exec(reply)) !== null) {
    const p = cleanPath(m[1]);
    if (!p) continue;
    const hit = wanted.find((w) => p === w || p.endsWith('/' + w)); // the AI sometimes adds the project folder in front
    if (hit) found.set(hit, m[2]);
  }
  if (found.size === 0 && wanted.length === 1) {
    const one = reply.match(/```[^\n]*\n([\s\S]*?)\n```/); // one file asked for, answered as one plain code block
    if (one) found.set(wanted[0], one[1]);
  }
  const files = [...found].map(([path, content]) => ({
    path,
    content: path.toLowerCase().endsWith('.md') ? content.replace(/^~~~/gm, '```') : content,
  }));
  return { files, truncated: (reply.match(/```/g) || []).length % 2 === 1 };
}

// ---------- 6. ask the model, and wait politely when it says "too many requests" ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitSeconds(message) {
  const m = message.match(/(?:try again|retry) in\s*((?:\d+(?:\.\d+)?\s*(?:ms|s|m|h)\s*)+)/i);
  if (!m) return 20;
  let total = 0;
  for (const part of m[1].matchAll(/(\d+(?:\.\d+)?)\s*(ms|s|m|h)/g)) {
    const n = parseFloat(part[1]);
    total += part[2] === 'ms' ? n / 1000 : part[2] === 's' ? n : part[2] === 'm' ? n * 60 : n * 3600;
  }
  return Math.max(2, Math.ceil(total) + 1);
}

const fail = (message, code) => Object.assign(new Error(message), { code });

export async function askModel({ backendUrl, model, messages, onWait, shouldStop }) {
  for (let attempt = 0; attempt < 6; attempt++) {
    let res;
    let data = {};
    try {
      res = await fetch(`${backendUrl}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: model.provider, model: model.model, messages }),
      });
      data = await res.json().catch(() => ({}));
    } catch (err) {
      throw new Error('Could not reach the backend: ' + err.message);
    }
    if (res.ok && data.reply) return data.reply;

    const err = String(data.error || `HTTP ${res.status}`);
    const dailyMsg = 'The daily limit of this model is used up. Your progress is saved: press Continue tomorrow, or pick another model and continue now.';
    if (/per\s*day|\bTPD\b|\bRPD\b/i.test(err)) throw fail(dailyMsg, 'DAILY');
    if (/request too large|too large for model|reduce your message size/i.test(err)) throw fail(err, 'TOO_LARGE');
    if (/429|rate.?limit|quota|resource.?exhausted|try again in|retry in/i.test(err)) {
      const secs = waitSeconds(err);
      if (secs > 600) throw fail(dailyMsg, 'DAILY');
      for (let s = secs; s > 0; s--) {
        if (shouldStop()) throw fail('Stopped.', 'STOP');
        onWait(s);
        await sleep(1000);
      }
      onWait(0);
      continue;
    }
    throw new Error(err);
  }
  throw new Error('The AI service kept answering "too many requests". Wait a few minutes and press Continue.');
}