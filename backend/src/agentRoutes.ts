import express from 'express';
import fs from 'fs';
import path from 'path';
import { spawn, exec, ChildProcess } from 'child_process';
import { chat } from './aiService';
import { onStopAll, stopEverything } from './procRegistry';

// AGENT MODE (like VS Code agent mode)
// POST /api/agent/run   body: { provider, model, goal, root, maxSteps? }
//   The AI answers with ACTIONS (write a file, run a command, start a server, test a URL ...).
//   This route executes them, sends the results back to the AI and repeats until the AI says @@done.
//   It streams one JSON object per line, so the chat can show every step live.
// POST /api/agent/stop  stops every server the agent started.

const router = express.Router();
const IS_WIN = process.platform === 'win32';

type Msg = { role: 'system' | 'user' | 'assistant'; content: string };
type Action =
  | { type: 'write'; path: string; content: string }
  | { type: 'read'; path: string }
  | { type: 'list'; path: string }
  | { type: 'run'; cwd: string; command: string }
  | { type: 'start'; cwd: string; command: string }
  | { type: 'get'; url: string }
  | { type: 'post'; url: string; body: string }
  | { type: 'stop' }
  | { type: 'done'; message: string };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const stripAnsi = (s: string) => s.replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '');
const tail = (s: string, n: number) => (s.length > n ? '…' + s.slice(-n) : s);
const isDir = (p: string) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p: string) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const toRel = (root: string, p: string) => path.relative(root, p).split(path.sep).join('/');

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);

// ---------- prompt ----------
function systemPrompt(): string {
  return `You are an autonomous coding agent inside an IDE, like VS Code agent mode. You build and repair projects by sending ACTIONS. After each reply the IDE runs your actions and sends you the results. Keep going until the project really runs, then finish with @@done.

ACTIONS (each starts at the beginning of a line):
@@write relative/path
<the full file content, no code fences>
@@end
@@read relative/path
@@list relative/folder          (use . for the project root)
@@run relative/folder :: command      a command that finishes: npm install, npm run build ...
@@start relative/folder :: command    a server that keeps running: npm start, npm run dev
@@get http://localhost:PORT/path      test a server you started
@@post http://localhost:PORT/path :: {"json":"body"}
@@stop                                 stops all running servers
@@done short summary for the user

RULES
1. Paths are relative to the project folder: never absolute, never "..". Always write COMPLETE files. Write at most 6 files per reply (longer replies get cut off); continue in the next reply.
2. Allowed commands: npm install [packages], npm run <script>, npm start, npm test, npm init -y, node <file>.js, npx vite|tsc|create-vite. One simple command per action: no &&, |, ;, > or $. Put the folder in the action instead of using cd. Put versions in package.json, not in the install command. Commands run on ${IS_WIN ? 'Windows (cmd.exe)' : process.platform}.
3. Normal order: say in 1-3 short sentences what you will build, write package.json and the code, @@run npm install in every folder that has a package.json, @@start the server, @@get the main routes (check that the JSON field names are exactly the ones the frontend reads), fix what is wrong, for a Vite/React website also @@run npm run build, then @@start npm run dev in the website folder and @@get http://localhost:5173/ , then @@done.
4. When an action fails you get the error output. Fix the CAUSE by rewriting the file; never delete a feature to make an error disappear. After changing server code, @@start it again (the old copy is stopped for you).
5. Ports: backend 3001, Vite website 5173. Never use 5000 or 3000 for a backend. If a port is in use, choose another and update every place that uses it.
6. If the user gives a folder structure or technology stack, follow it exactly. If not: a small app is ONE Express project (server.js + public/index.html, styles.css, app.js, API under /api); a full-stack project is server/ (Express, CORS on) plus client/ (Vite + React 18, calling http://localhost:3001).
7. Pinned versions that work together: react ^18.3.1, react-dom ^18.3.1, vite ^5.4.0, @vitejs/plugin-react ^4.3.1, express ^4.19.2, cors ^2.8.5, dotenv ^16.4.5. Every import must point to a file you wrote or to a package listed in that folder's package.json. React/Vite projects need index.html, vite.config.js, src/main.jsx.
8. Storage: JSON file or in memory, unless the user explicitly asks for a database. MongoDB is NOT running on this computer: if the user requires it, write the code plus a .env.example, then @@done and tell them to start MongoDB or set MONGO_URI.
9. Design is as important as code: modern, polished UI, a cohesive color palette, good spacing, hover and focus states, loading and empty states, responsive layout, all CSS in its own file. The frontend must use EXACTLY the same API paths and field names as the backend.
10. Never ask the user questions. Make sensible assumptions and mention them in @@done. Outside actions write at most 3 short sentences.
11. Before @@done the backend must have started and answered an @@get, and a Vite/React website must have built AND be running with @@start npm run dev. Also give every backend a GET / route that returns a short JSON message such as {"status":"API running"}.`;
}

// ---------- reading the AI reply ----------
function stripFence(body: string[]): string {
  const b = body.slice();
  while (b.length && b[0].trim() === '') b.shift();
  while (b.length && b[b.length - 1].trim() === '') b.pop();
  if (b.length >= 2 && /^\s*```/.test(b[0]) && /^\s*```\s*$/.test(b[b.length - 1])) { b.shift(); b.pop(); }
  return b.join('\n') + '\n';
}

function parseReply(reply: string): { actions: Action[]; text: string; truncated: string | null } {
  const lines = reply.replace(/\r/g, '').split('\n');
  const actions: Action[] = [];
  const narrative: string[] = [];
  let truncated: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*@@(\w+)\b[ \t]*(.*)$/);
    if (!m) { if (!/^\s*```/.test(lines[i])) narrative.push(lines[i]); continue; }
    const kind = m[1].toLowerCase();
    const rest = m[2].trim().replace(/^`+|`+$/g, '');

    if (kind === 'write') {
      const body: string[] = [];
      let closed = false;
      for (i = i + 1; i < lines.length; i++) {
        if (/^\s*@@end\s*$/i.test(lines[i])) { closed = true; break; }
        body.push(lines[i]);
      }
      if (!closed) { truncated = rest; break; } // the answer was cut off in the middle of this file
      actions.push({ type: 'write', path: rest, content: stripFence(body) });
    } else if (kind === 'read') actions.push({ type: 'read', path: rest });
    else if (kind === 'list') actions.push({ type: 'list', path: rest || '.' });
    else if (kind === 'run' || kind === 'start') {
      const k = rest.indexOf('::');
      const cwd = k >= 0 ? rest.slice(0, k).trim() : '.';
      const command = (k >= 0 ? rest.slice(k + 2) : rest).trim();
      actions.push({ type: kind as 'run' | 'start', cwd: cwd || '.', command });
    } else if (kind === 'get') actions.push({ type: 'get', url: rest });
    else if (kind === 'post') {
      const k = rest.indexOf('::');
      actions.push({ type: 'post', url: (k >= 0 ? rest.slice(0, k) : rest).trim(), body: k >= 0 ? rest.slice(k + 2).trim() : '{}' });
    } else if (kind === 'stop') actions.push({ type: 'stop' });
    else if (kind === 'done') {
      actions.push({ type: 'done', message: [rest, ...lines.slice(i + 1)].join('\n').trim() });
      break;
    }
  }
  return { actions, text: narrative.join('\n').trim(), truncated };
}

// how an action is remembered in the history (file contents are NOT repeated, to save tokens)
function compact(a: Action): string {
  switch (a.type) {
    case 'write': return `@@write ${a.path}\n(saved, ${a.content.split('\n').length - 1} lines)\n@@end`;
    case 'read': return `@@read ${a.path}`;
    case 'list': return `@@list ${a.path}`;
    case 'run': return `@@run ${a.cwd} :: ${a.command}`;
    case 'start': return `@@start ${a.cwd} :: ${a.command}`;
    case 'get': return `@@get ${a.url}`;
    case 'post': return `@@post ${a.url} :: ${a.body}`;
    case 'stop': return '@@stop';
    case 'done': return `@@done ${a.message}`;
  }
}

// ---------- command safety ----------
const PKG = /^(@[a-z0-9~][\w.~-]*\/)?[a-z0-9~][\w.~-]*(@[\w.-]+)?$/i;
const FLAG = /^--?[a-z][\w-]*$/i;
const SIMPLE = /^[\w./:=@-]+$/;

// returns an error text when the command is not allowed
function checkCommand(raw: string): string | null {
  const cmd = raw.trim();
  if (!cmd) return 'Empty command.';
  if (/[;&|<>`$()\n\r]/.test(cmd)) {
    return 'Shell operators ; & | < > ` $ ( ) are not allowed. Send one simple command per action and use the folder part of @@run / @@start instead of "cd".';
  }
  const parts = cmd.split(/\s+/);
  const bin = parts[0].toLowerCase();
  const sub = (parts[1] || '').toLowerCase();
  const rest = parts.slice(2);
  const allowedList = 'Allowed: npm install [packages], npm run <script>, npm start, npm test, npm init -y, node <file>.js, npx vite|tsc|create-vite.';

  if (bin === 'npm') {
    if (['install', 'i', 'ci', 'uninstall'].includes(sub)) {
      const bad = rest.find((a) => !(FLAG.test(a) || PKG.test(a)));
      return bad ? `"${bad}" is not an allowed install argument. Use plain package names. ${allowedList}` : null;
    }
    if (sub === 'run' || sub === 'run-script') {
      if (!rest[0] || !/^[\w:.-]+$/.test(rest[0])) return 'Use: npm run <script-name>.';
      const bad = rest.slice(1).find((a) => !(a === '--' || FLAG.test(a) || SIMPLE.test(a)));
      return bad ? `Argument "${bad}" is not allowed.` : null;
    }
    if (sub === 'start' || sub === 'test') {
      const bad = rest.find((a) => !(a === '--' || FLAG.test(a) || SIMPLE.test(a)));
      return bad ? `Argument "${bad}" is not allowed.` : null;
    }
    if (sub === 'init') return rest.length === 1 && (rest[0] === '-y' || rest[0] === '--yes') ? null : 'Use: npm init -y';
    return `npm ${sub || ''} is not allowed. ${allowedList}`;
  }
  if (bin === 'node') {
    if (!/^[\w./-]+\.(c|m)?js$/.test(parts[1] || '') || (parts[1] || '').includes('..')) return `Use: node <file>.js (no options). ${allowedList}`;
    const bad = rest.find((a) => !SIMPLE.test(a));
    return bad ? `Argument "${bad}" is not allowed.` : null;
  }
  if (bin === 'npx') {
    const args = parts.slice(1).filter((a) => a !== '--yes' && a !== '-y');
    const tool = args[0] || '';
    if (!(['vite', 'tsc', 'create-vite'].includes(tool) || /^create-vite@[\w.]+$/.test(tool))) return `npx ${tool} is not allowed. ${allowedList}`;
    const bad = args.slice(1).find((a) => !(a === '--' || FLAG.test(a) || SIMPLE.test(a)));
    return bad ? `Argument "${bad}" is not allowed.` : null;
  }
  return `"${parts[0]}" is not allowed. ${allowedList}`;
}

// commands that never finish by themselves are started as servers
function isServerCommand(cmd: string): boolean {
  const c = cmd.trim();
  return /^npm\s+(start|run\s+(start|dev|serve|preview|watch))\b/i.test(c)
    || /^node\s+(?!-)\S*(server|app|index|main)\S*\.(c|m)?js\b/i.test(c);
}

// ---------- processes ----------
type Proc = { child: ChildProcess; cwd: string; command: string; port: number | null; output: string; exited: boolean; code: number | null };
const procs = new Map<number, Proc>();
let procSeq = 0;

function killTree(child: ChildProcess) {
  if (!child.pid) return;
  if (IS_WIN) exec(`taskkill /pid ${child.pid} /T /F`);
  else child.kill('SIGKILL');
}

function stopAll() {
  for (const p of procs.values()) killTree(p.child);
  procs.clear();
}
onStopAll(stopAll); // the ▶ Run button can stop the agent's servers too

function spawnShell(cwd: string, command: string): ChildProcess {
  return spawn(command, [], {
    cwd,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'], // no keyboard input: anything that asks a question ends instead of hanging
    env: { ...process.env, BROWSER: 'none', NO_COLOR: '1', npm_config_fund: 'false', npm_config_audit: 'false' },
  });
}

function runCmd(cwd: string, command: string, timeoutMs: number, onOut: (d: string) => void, shouldStop: () => boolean) {
  return new Promise<{ code: number | null; timedOut: boolean; output: string }>((resolve) => {
    let output = '';
    let timedOut = false;
    let done = false;
    const child = spawnShell(cwd, command);
    const collect = (b: Buffer) => {
      const s = stripAnsi(b.toString());
      output += s;
      if (output.length > 60000) output = output.slice(-30000);
      onOut(s);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    const poll = setInterval(() => { if (shouldStop()) killTree(child); }, 500);
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(poll);
      resolve({ code, timedOut, output });
    };
    child.on('close', (c) => finish(c));
    child.on('error', (e) => { output += '\n' + e.message; finish(1); });
  });
}

// only real "server is up" lines count (not "Port 5173 is in use, trying another one")
function findPort(text: string): number | null {
  const full = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})/i);
  if (full) return Number(full[1]);
  const m = text.match(/\b(?:listening|running|started|available)\s+(?:on|at)\s+(?:port\s*:?\s*)?:?(\d{2,5})\b/i);
  return m ? Number(m[1]) : null;
}

async function startServer(cwd: string, command: string, onOut: (d: string) => void, shouldStop: () => boolean) {
  let hadOld = false;
  for (const [id, p] of procs) {
    if (p.cwd === cwd && !p.exited) { killTree(p.child); procs.delete(id); hadOld = true; }
  }
  if (hadOld) await sleep(1200); // let the port be released

  const child = spawnShell(cwd, command);
  const proc: Proc = { child, cwd, command, port: null, output: '', exited: false, code: null };
  procs.set(++procSeq, proc);
  const collect = (b: Buffer) => {
    const s = stripAnsi(b.toString());
    proc.output += s;
    if (proc.output.length > 60000) proc.output = proc.output.slice(-30000);
    onOut(s);
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  child.on('close', (c) => { proc.exited = true; proc.code = c; });
  child.on('error', (e) => { proc.output += '\n' + e.message; proc.exited = true; proc.code = 1; });

  const t0 = Date.now();
  while (Date.now() - t0 < 30000 && !proc.exited && proc.port === null && !shouldStop()) {
    await sleep(250);
    proc.port = findPort(proc.output);
  }
  // many servers print "listening" first and crash a moment later (database connection, bad route ...)
  if (proc.port !== null && !proc.exited) await sleep(2500);

  // read the state AFTER the wait, but never count our own stop as a crash
  const status: 'running' | 'crashed' | 'noport' = proc.exited ? 'crashed' : (proc.port !== null ? 'running' : 'noport');
  return { status, port: proc.port, code: proc.code, output: proc.output };
}

function hints(out: string): string {
  const h: string[] = [];
  if (/EADDRINUSE/.test(out)) h.push('HINT: a port is already in use. Use another port (for example 3002 for the backend) and update every place that uses it.');
  if (/MongooseServerSelectionError|MongoNetworkError|ECONNREFUSED[^\n]*27017|MongoParseError/i.test(out)) {
    h.push('HINT: MongoDB is not available on this computer. Unless the user required MongoDB, switch to JSON-file storage. If it is required, send @@done and tell the user to start MongoDB or set MONGO_URI.');
  }
  const mod = out.match(/Cannot find (?:module|package) '([^'./][^']*)'/);
  if (mod) h.push(`HINT: the package "${mod[1]}" is missing. Add it to package.json of the folder that uses it and run npm install there.`);
  if (/is not recognized as an internal or external command|command not found/i.test(out)) h.push('HINT: a tool is not installed. Run npm install in that folder first and check that the tool is listed in its package.json.');
  if (/ERESOLVE/.test(out)) h.push('HINT: dependency version conflict. Use matching versions in package.json (react and react-dom must have the same version) and run npm install again.');
  if (/ENOENT[^\n]*package\.json/.test(out)) h.push('HINT: there is no package.json in that folder. Write it first, or use the right folder in the action.');
  return h.join('\n');
}

// ---------- project helpers ----------
function listTree(root: string, dir: string, depth: number, out: string[] = []): string[] {
  if (out.length > 120) return out;
  let names: string[] = [];
  try { names = fs.readdirSync(dir).sort(); } catch { return out; }
  for (const n of names) {
    if (SKIP.has(n)) continue;
    const p = path.join(dir, n);
    if (isDir(p)) {
      out.push(toRel(root, p) + '/');
      if (depth > 1) listTree(root, p, depth - 1, out);
    } else out.push(toRel(root, p));
  }
  return out;
}

function packageDirs(root: string, depth = 0): string[] {
  if (depth > 3) return [];
  let found: string[] = [];
  try {
    if (isFile(path.join(root, 'package.json'))) found.push(root);
    for (const n of fs.readdirSync(root)) {
      if (SKIP.has(n) || n.startsWith('.')) continue;
      const p = path.join(root, n);
      if (isDir(p)) found = found.concat(packageDirs(p, depth + 1));
    }
  } catch { /* unreadable folder */ }
  return found;
}

function needsRun(root: string): boolean {
  return packageDirs(root).some((d) => {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')).scripts || {};
      return !!(s.start || s.dev || s.build);
    } catch { return false; }
  });
}

// a Vite website must have dev and build scripts; add them if the AI forgot
function fixViteScripts(file: string) {
  try {
    const p = JSON.parse(fs.readFileSync(file, 'utf8'));
    const deps = { ...(p.dependencies || {}), ...(p.devDependencies || {}) };
    if (!deps.vite) return;
    p.scripts = p.scripts || {};
    let changed = false;
    if (!p.scripts.dev) { p.scripts.dev = 'vite'; changed = true; }
    if (!p.scripts.build) { p.scripts.build = 'vite build'; changed = true; }
    if (changed) fs.writeFileSync(file, JSON.stringify(p, null, 2) + '\n', 'utf8');
  } catch { /* package.json is not valid JSON yet: the AI will see the npm error */ }
}

// Vite websites that have a dev script but are not running right now
function sitesNotRunning(root: string): string[] {
  return packageDirs(root).filter((d) => {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8'));
      const deps = { ...(p.dependencies || {}), ...(p.devDependencies || {}) };
      return !!deps.vite && !!(p.scripts && p.scripts.dev);
    } catch { return false; }
  }).filter((d) => ![...procs.values()].some((p) => p.cwd === d && !p.exited));
}

function safeJoin(root: string, rel: string): string | null {
  const t = path.resolve(root, rel || '.');
  if (t !== root && !t.startsWith(root + path.sep)) return null;
  return t;
}

function bestUrl(): string | null {
  const alive = [...procs.values()].filter((p) => !p.exited && p.port !== null);
  if (!alive.length) return null;
  const site = alive.find((p) => /^(5173|5174|4173|3000|8080|4200)$/.test(String(p.port)));
  return `http://localhost:${(site || alive[alive.length - 1]).port}`;
}

// ---------- talking to the AI (waits when a free-tier rate limit is hit) ----------
async function askAI(
  provider: string, model: string, messages: Msg[],
  send: (o: object) => void, isAborted: () => boolean,
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await chat({ provider: provider as any, model, messages });
    } catch (e: any) {
      const msg = String((e && e.message) || e);
      const limited = /rate.?limit|429|quota|resource.?exhausted|try again|retry in/i.test(msg);
      if (!limited || attempt >= 4 || /per day|daily|\bTPD\b|RPD/i.test(msg)) throw e;
      const t = msg.match(/(?:try again|retry) in (?:(\d+)m)?\s*([\d.]+)s/i);
      const secs = Math.min(70, Math.max(5, Math.ceil(t ? (Number(t[1] || 0) * 60 + Number(t[2])) : 20)));
      for (let s = secs; s > 0; s--) {
        if (isAborted()) throw new Error('stopped');
        send({ t: 'wait', seconds: s });
        await sleep(1000);
      }
      send({ t: 'wait', seconds: 0 });
    }
  }
}

// ---------- the route ----------
router.post('/stop', (_req, res) => {
  stopAll();
  res.json({ success: true });
});

router.post('/run', async (req, res) => {
  const { provider, model, goal, root: rawRoot, maxSteps } = req.body || {};
  if (!provider || !model || !goal || !rawRoot) {
    return res.status(400).json({ error: 'provider, model, goal and root are required' });
  }
  const root = path.resolve(String(rawRoot));
  if (!isDir(root)) return res.status(400).json({ error: 'root is not an existing folder' });

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  let aborted = false;
  res.on('close', () => { if (!res.writableEnded) aborted = true; }); // the Stop button closes the connection
  const isAborted = () => aborted;
  const send = (o: object) => { if (!aborted) res.write(JSON.stringify(o) + '\n'); };
  const fail = (message: string) => { send({ t: 'error', message }); if (!aborted) res.end(); };

  const max = Math.min(Math.max(Number(maxSteps) || 30, 5), 60);
  stopEverything(); // a new run starts with no old servers, also none from the ▶ Run button (frees the ports)

  const first = `GOAL:\n${String(goal).slice(0, 6000)}\n\nPROJECT FOLDER (the folder open in the IDE) currently contains:\n${listTree(root, root, 2).join('\n') || '(empty)'}\n\nExisting files that are not part of the goal must stay untouched. Start now.`;
  const history: Msg[] = [{ role: 'system', content: systemPrompt() }, { role: 'user', content: first }];
  const written = new Set<string>();
  let cmdSeq = 0;
  let verified = false;
  let doneRejected = false;
  let siteRejected = false;
  let nudges = 0;

  try {
    for (let step = 1; step <= max; step++) {
      if (aborted) return;
      send({ t: 'step', n: step, max });

      // keep the goal and the last 6 exchanges; older exchanges are summarised by the "files so far" line
      const rest = history.slice(2);
      const messages = [history[0], history[1], ...rest.slice(-12)];
      const reply = await askAI(provider, model, messages, send, isAborted);
      if (aborted) return;

      const { actions, text, truncated } = parseReply(reply);
      if (text) send({ t: 'ai', text: text.slice(0, 500) });

      const results: string[] = [];
      if (truncated) {
        results.push(`Your last file "${truncated}" was cut off because the answer was too long, so it was NOT saved. Write it again (alone, shorter if needed).`);
      }
      if (actions.length === 0 && !truncated) {
        nudges++;
        if (nudges > 2) return fail('The AI is not sending any actions. Pick a stronger model (Gemini or Groq llama-3.3-70b-versatile) and try again.');
        history.push({ role: 'assistant', content: reply.slice(0, 1500) });
        history.push({ role: 'user', content: 'No actions found. Answer ONLY with actions (@@write ... @@end, @@run, @@start, @@get ...). When the project works, send @@done.' });
        continue;
      }
      nudges = 0;

      let finalMessage: string | null = null;
      let stoppedEarly = false;

      for (const a of actions) {
        if (aborted) return;
        if (stoppedEarly) break;

        if (a.type === 'write') {
          const norm = a.path.replace(/\\/g, '/').replace(/^\.\//, '');
          const target = safeJoin(root, norm);
          if (!norm || !target || target === root || path.isAbsolute(norm) || /(^|\/)(node_modules|\.git)(\/|$)/.test(norm)) {
            results.push(`ERROR: cannot write "${a.path}" (use a relative path inside the project, not node_modules or .git).`);
            continue;
          }
          if (a.content.length > 250000) { results.push(`ERROR: ${norm} is too large.`); continue; }
          const existed = isFile(target);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, a.content, 'utf8');
          if (/(^|\/)package\.json$/.test(norm)) fixViteScripts(target);
          written.add(norm);
          const lines = a.content.split('\n').length - 1;
          send({ t: 'file', path: norm, lines, created: !existed });
          results.push(`wrote ${norm} (${lines} lines)`);
        } else if (a.type === 'read') {
          const target = safeJoin(root, a.path);
          if (!target || !isFile(target)) { results.push(`ERROR: ${a.path} does not exist.`); continue; }
          const text2 = fs.readFileSync(target, 'utf8');
          results.push(`${a.path}:\n${text2.length > 8000 ? text2.slice(0, 8000) + '\n... [cut]' : text2}`);
        } else if (a.type === 'list') {
          const target = safeJoin(root, a.path);
          if (!target || !isDir(target)) { results.push(`ERROR: folder ${a.path} does not exist.`); continue; }
          results.push(`${a.path}:\n${listTree(root, target, 2).join('\n') || '(empty)'}`);
        } else if (a.type === 'run' || a.type === 'start') {
          const cwd = safeJoin(root, a.cwd);
          if (!cwd || !isDir(cwd)) {
            results.push(`ERROR: folder "${a.cwd}" does not exist. Write the files there first.`);
            stoppedEarly = true;
            continue;
          }
          const bad = checkCommand(a.command);
          if (bad) { results.push(`ERROR: ${bad}`); stoppedEarly = true; continue; }
          const asServer = a.type === 'start' || isServerCommand(a.command);
          const id = ++cmdSeq;
          const rel = toRel(root, cwd) || '.';
          send({ t: 'cmd', id, cwd: rel, command: a.command, server: asServer });
          const onOut = (d: string) => send({ t: 'out', id, data: d.slice(-1500) });

          if (asServer) {
            const r = await startServer(cwd, a.command, onOut, isAborted);
            if (aborted) return;
            const url = r.port !== null ? `http://localhost:${r.port}` : null;
            if (r.status === 'running') {
              verified = true;
              send({ t: 'cmd_end', id, code: null, status: 'running', url });
              if (url) send({ t: 'url', url });
              results.push(`STARTED "${a.command}" in ${rel}: server is running on ${url}. Output:\n${tail(r.output, 600)}`);
            } else if (r.status === 'noport') {
              send({ t: 'cmd_end', id, code: null, status: 'running', url: null });
              results.push(`STARTED "${a.command}" in ${rel}: still running after 30 s but it printed no address. Output:\n${tail(r.output, 1500)}\nIf this should be a web server, make it print "Server running on http://localhost:PORT".`);
            } else {
              verified = false;
              send({ t: 'cmd_end', id, code: r.code, status: 'failed' });
              results.push(`FAILED "${a.command}" in ${rel}: the program stopped (exit code ${r.code}). Output:\n${tail(r.output, 2500)}\n${hints(r.output)}`);
              stoppedEarly = true;
            }
          } else {
            const limit = /^npm\s+(install|i|ci)\b/i.test(a.command) || /create-vite/.test(a.command) ? 300000 : 180000;
            const r = await runCmd(cwd, a.command, limit, onOut, isAborted);
            if (aborted) return;
            const ok = r.code === 0 && !r.timedOut;
            send({ t: 'cmd_end', id, code: r.code, status: r.timedOut ? 'timeout' : (ok ? 'ok' : 'failed') });
            if (ok) {
              if (/^npm\s+run\s+build\b/i.test(a.command)) verified = true;
              results.push(`OK "${a.command}" in ${rel}. Output:\n${tail(r.output, 500)}`);
            } else {
              results.push(`FAILED "${a.command}" in ${rel}: ${r.timedOut ? 'timed out (if it is a server use @@start)' : 'exit code ' + r.code}. Output:\n${tail(r.output, 2500)}\n${hints(r.output)}`);
              stoppedEarly = true;
            }
          }
        } else if (a.type === 'get' || a.type === 'post') {
          const m = a.url.match(/^https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)(\/\S*)?$/i);
          const alive = [...procs.values()].filter((p) => !p.exited && p.port !== null).map((p) => p.port);
          if (!m || !alive.includes(Number(m[1]))) {
            results.push(`ERROR: no server of yours is running on "${a.url}". Use @@start first and the exact address it printed.`);
            continue;
          }
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), 8000);
          try {
            const r = await fetch(a.url, a.type === 'post'
              ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: a.body, signal: ctl.signal }
              : { signal: ctl.signal });
            const body = (await r.text().catch(() => '')).slice(0, 500);
            send({ t: 'http', method: a.type.toUpperCase(), url: a.url, status: r.status });
            results.push(`${a.type.toUpperCase()} ${a.url} -> ${r.status}\n${body}${r.status >= 500 ? '\nHINT: a 5xx answer is a server bug: read the server code and fix it.' : ''}`);
          } catch (e: any) {
            send({ t: 'http', method: a.type.toUpperCase(), url: a.url, status: 0 });
            results.push(`${a.type.toUpperCase()} ${a.url} -> no answer (${e && e.name === 'AbortError' ? 'timeout' : (e && e.message)})`);
          } finally { clearTimeout(timer); }
        } else if (a.type === 'stop') {
          stopAll();
          results.push('all servers stopped');
        } else if (a.type === 'done') {
          const sites = sitesNotRunning(root);
          if (!doneRejected && !verified && needsRun(root)) {
            doneRejected = true;
            results.push('NOT FINISHED: the app has not been started and tested. Run npm install, @@start the server and @@get a route (or @@run npm run build for a website). If it really cannot run on this computer (for example it needs MongoDB), explain that in a new @@done.');
          } else if (!siteRejected && sites.length > 0) {
            siteRejected = true;
            results.push(`NOT FINISHED: the website in "${toRel(root, sites[0]) || '.'}" is not running. @@start npm run dev in that folder, then @@get its page (for Vite: http://localhost:5173/), then send @@done.`);
          } else {
            finalMessage = a.message || 'Finished.';
          }
        }
      }

      if (stoppedEarly) results.push('(the remaining actions were skipped because an action failed; fix it first)');

      if (finalMessage !== null) {
        send({ t: 'done', message: finalMessage, url: bestUrl() });
        return res.end();
      }

      history.push({ role: 'assistant', content: (text ? text.slice(0, 300) + '\n' : '') + actions.map(compact).join('\n') });
      const sofar = [...written].slice(-60).join(', ');
      history.push({ role: 'user', content: `RESULTS:\n${results.join('\n\n').slice(0, 9000)}\n\nFILES WRITTEN SO FAR: ${sofar || '(none)'}\nContinue with the next actions, or send @@done when everything works.` });
    }
    fail(`Reached the step limit (${max}). Send "continue" in Agent mode to go on from where it stopped.`);
  } catch (err: any) {
    if (String(err && err.message) === 'stopped') return;
    fail(String((err && err.message) || err));
  }
});

export default router;