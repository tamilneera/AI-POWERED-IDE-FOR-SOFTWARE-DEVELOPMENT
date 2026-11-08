import express from 'express';
import fs from 'fs';
import path from 'path';
import { spawn, exec, ChildProcess } from 'child_process';
import { chat } from './aiService';

const router = express.Router();

// ---------- constants ----------
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.next']);
const CODE_EXT = /\.(?:jsx?|tsx?|mjs|cjs)$/i;
const RESOLVE_EXT = ['', '.js', '.jsx', '.ts', '.tsx', '.json', '.cjs', '.mjs'];
const BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto', 'dgram', 'dns', 'domain',
  'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode',
  'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'timers', 'tls', 'tty', 'url', 'util', 'v8', 'vm',
  'worker_threads', 'zlib',
]);

// versions used when a missing package has to be added (compatible majors that work together)
const KNOWN_VERSIONS: Record<string, string> = {
  react: '^18.3.1', 'react-dom': '^18.3.1', 'react-router-dom': '^6.26.0', axios: '^1.7.0', 'react-icons': '^5.3.0',
  vite: '^5.4.0', '@vitejs/plugin-react': '^4.3.1', express: '^4.19.2', cors: '^2.8.5', dotenv: '^16.4.5',
  mongoose: '^8.5.0', jsonwebtoken: '^9.0.2', bcryptjs: '^2.4.3', nodemon: '^3.1.0', concurrently: '^8.2.2',
  'express-validator': '^7.2.0', helmet: '^7.1.0', morgan: '^1.10.0', 'cookie-parser': '^1.4.6',
  multer: '^1.4.5-lts.1', uuid: '^9.0.1', recharts: '^2.12.7', 'react-toastify': '^10.0.5', 'date-fns': '^3.6.0',
  'socket.io': '^4.7.5', 'socket.io-client': '^4.7.5', 'cross-env': '^7.0.3',
};
const DEV_ONLY = new Set(['vite', '@vitejs/plugin-react', 'nodemon', 'concurrently', 'cross-env']);
const SCRIPT_TOOLS = ['concurrently', 'nodemon', 'vite', 'cross-env'];

const FIX_PROMPT = `You are fixing a Node project that fails to run. You get the problems found (error output, missing files, failed builds) and the files related to them.
Return ONLY the files that must change or that must be created. Write each one as a line "FILE: relative/path" followed by a code block with the FULL new content of that file.
Example:
FILE: server.js
\`\`\`js
console.log("hi");
\`\`\`
Rules: relative paths only, never "..". Write complete files, never snippets or "...". Fix the cause of each problem; never remove a feature just to make an error go away. If an import points to a file that does not exist, write that file completely, matching how it is used. If a dependency is missing, fix package.json. If the frontend and backend disagree on routes or field names, fix the files so they match. No explanations.`;

const ERROR_RE = /Failed to compile|Cannot find module|SyntaxError|ReferenceError|\w*Error: |EADDRINUSE|ERR_MODULE_NOT_FOUND|npm ERR!|Module not found/i;
const stripAnsi = (s: string) => s.replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type RunResult = { exitCode: number | null; timedOut: boolean; output: string };
type PkgInfo = { dir: string; file: string; pkg: any };
type Probe = { path: string; status?: number; error?: string };

// ---------- file system helpers ----------
function isDir(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function isFile(p: string): boolean {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function toRel(root: string, p: string): string {
  return path.relative(root, p).split(path.sep).join('/');
}

// every file of the project (relative paths), without node_modules and build folders
function listFiles(root: string, dir: string = root, acc: string[] = []): string[] {
  if (acc.length > 2000) return acc;
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return acc; }
  for (const name of names) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
    const p = path.join(dir, name);
    if (isDir(p)) listFiles(root, p, acc);
    else if (isFile(p)) acc.push(toRel(root, p));
  }
  return acc;
}

function findPackageDirs(root: string, depth = 0): string[] {
  if (depth > 3) return [];
  let found: string[] = [];
  try {
    if (isFile(path.join(root, 'package.json'))) found.push(root);
    for (const name of fs.readdirSync(root)) {
      if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
      const p = path.join(root, name);
      if (isDir(p)) found = found.concat(findPackageDirs(p, depth + 1));
    }
  } catch {
    // unreadable folder: skip it
  }
  return found;
}

// ---------- running commands ----------
function killTree(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === 'win32') exec(`taskkill /pid ${child.pid} /T /F`);
  else child.kill('SIGKILL');
}

function runCommand(cwd: string, command: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    let done = false;
    let timer: NodeJS.Timeout | undefined;

    const child = spawn(command, [], { cwd, shell: true, env: { ...process.env, BROWSER: 'none' } });
    const collect = (d: Buffer) => {
      output += d.toString();
      if (output.length > 40000) output = output.slice(-20000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve({ exitCode: code, timedOut, output: stripAnsi(output).slice(-8000) });
    };

    timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    child.on('close', (code) => finish(code));
    child.on('error', (e) => { output += '\n' + e.message; finish(1); });
  });
}

// ---------- reading the AI answer ----------
function parseFiles(text: string): { path: string; content: string }[] {
  const re = /^[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*)?FILE:[ \t]*`?([^\n`*]+?)`?(?:\*\*)?[ \t]*\n+```[^\n]*\n([\s\S]*?)\n```/gm;
  const files: { path: string; content: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    files.push({ path: m[1].trim().replace(/\\/g, '/'), content: m[2] });
  }
  return files;
}

function writeFiles(root: string, files: { path: string; content: string }[]): string[] {
  const written: string[] = [];
  for (const f of files) {
    const target = path.resolve(root, f.path);
    // stay inside the project, never touch node_modules
    if (!target.startsWith(root + path.sep) || target.includes('node_modules')) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.content, 'utf8');
    written.push(f.path);
  }
  return written;
}

// ---------- static checks (free, no AI) ----------
function importSpecs(text: string): string[] {
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const out: string[] = [];
  const patterns = [
    /\bimport\s+(?:[\w*${}\s,]+?\s+from\s+)?['"]([^'"\n]+)['"]/g,
    /\bexport\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"\n]+)['"]/g,
    /\brequire\(\s*['"]([^'"\n]+)['"]\s*\)/g,
    /\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      if (out.indexOf(m[1]) < 0) out.push(m[1]);
    }
  }
  return out;
}

function resolves(dir: string, spec: string): boolean {
  const clean = spec.split('?')[0].split('#')[0];
  const base = path.resolve(dir, clean);
  for (const ext of RESOLVE_EXT) {
    if (isFile(base + ext)) return true;
  }
  for (const ext of RESOLVE_EXT.slice(1)) {
    if (isFile(path.join(base, 'index' + ext))) return true;
  }
  return false;
}

const hasDep = (p: PkgInfo, name: string) =>
  !!((p.pkg.dependencies && p.pkg.dependencies[name]) || (p.pkg.devDependencies && p.pkg.devDependencies[name]));

const isClientPkg = (p: PkgInfo) => hasDep(p, 'react') || hasDep(p, 'vite') || hasDep(p, 'react-scripts');

// finds problems that can be fixed without running anything, and fixes the simple ones itself
function staticCheck(root: string): { problems: string[]; changedDirs: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  const changed: string[] = [];

  const pkgs: PkgInfo[] = [];
  for (const dir of findPackageDirs(root)) {
    const file = path.join(dir, 'package.json');
    try {
      pkgs.push({ dir, file, pkg: JSON.parse(fs.readFileSync(file, 'utf8')) });
    } catch (e: any) {
      problems.push(`${toRel(root, file)} is not valid JSON: ${e.message}`);
    }
  }
  const byDepth = [...pkgs].sort((a, b) => b.dir.length - a.dir.length);
  const ownerOf = (f: string) => byDepth.find((p) => f.startsWith(p.dir + path.sep));

  const added: Record<string, string[]> = {};
  const addDep = (p: PkgInfo, name: string) => {
    const key = DEV_ONLY.has(name) ? 'devDependencies' : 'dependencies';
    p.pkg[key] = p.pkg[key] || {};
    p.pkg[key][name] = KNOWN_VERSIONS[name] || 'latest';
    (added[p.dir] = added[p.dir] || []);
    if (added[p.dir].indexOf(name) < 0) added[p.dir].push(name);
  };

  // imports: files must exist, packages must be declared
  for (const rel of listFiles(root)) {
    if (!CODE_EXT.test(rel)) continue;
    const abs = path.join(root, rel);
    let text = '';
    try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    if (text.length > 400000) continue;
    const own = ownerOf(abs);

    for (const spec of importSpecs(text)) {
      if (spec.startsWith('.')) {
        if (!resolves(path.dirname(abs), spec)) problems.push(`${rel} imports "${spec}" but that file does not exist.`);
        continue;
      }
      if (!own || spec.startsWith('/') || spec.startsWith('@/') || spec.startsWith('~') || spec.startsWith('node:') || spec.indexOf(':') >= 0) continue;
      const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      if (!name || BUILTINS.has(name) || hasDep(own, name)) continue;
      // "src/utils" or "components/Card" are folders of the project, not npm packages
      if (isDir(path.join(own.dir, name)) || isDir(path.join(own.dir, 'src', name))) {
        problems.push(`${rel} imports "${spec}", which looks like a folder of the project. Use a relative path such as "./${spec}".`);
        continue;
      }
      if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name)) continue;
      addDep(own, name);
    }
  }

  for (const p of pkgs) {
    // tools used in scripts must be installed
    const scriptText = Object.keys(p.pkg.scripts || {}).map((k) => String(p.pkg.scripts[k])).join(' ; ');
    for (const tool of SCRIPT_TOOLS) {
      if (new RegExp('(^|[\\s&;|(])' + tool + '(\\s|$)').test(scriptText) && !hasDep(p, tool)) addDep(p, tool);
    }

    // missing scripts that are obvious
    p.pkg.scripts = p.pkg.scripts || {};
    let scriptsChanged = false;
    if (isClientPkg(p) && hasDep(p, 'vite')) {
      if (!p.pkg.scripts.dev) { p.pkg.scripts.dev = 'vite'; scriptsChanged = true; }
      if (!p.pkg.scripts.build) { p.pkg.scripts.build = 'vite build'; scriptsChanged = true; }
    } else if (hasDep(p, 'express') && !p.pkg.scripts.start) {
      const entry = ['server.js', 'index.js', 'app.js', 'src/server.js', 'src/index.js'].find((e) => isFile(path.join(p.dir, e)));
      if (entry) { p.pkg.scripts.start = `node ${entry}`; scriptsChanged = true; }
    }

    const names = added[p.dir] || [];
    if (names.length > 0 || scriptsChanged) {
      fs.writeFileSync(p.file, JSON.stringify(p.pkg, null, 2) + '\n', 'utf8');
      if (changed.indexOf(p.dir) < 0) changed.push(p.dir);
      if (names.length > 0) notes.push(`Added missing dependencies to ${toRel(root, p.file)}: ${names.join(', ')}`);
      if (scriptsChanged) notes.push(`Added missing scripts to ${toRel(root, p.file)}`);
    }
  }
  return { problems, changedDirs: changed, notes };
}

// ---------- runtime checks ----------
function findPort(text: string): number | null {
  const full = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})/i);
  if (full) return Number(full[1]);
  const m = text.match(/\blistening on (?:port )?:?(\d{2,5})\b/i) || text.match(/\bport\s*(?:number\s*)?(?:is\s*)?:?\s*(\d{2,5})\b/i);
  return m ? Number(m[1]) : null;
}

// URLs worth asking the server for: the main page and the routes found in its source
function discoverPaths(root: string, dir: string): string[] {
  const found: string[] = [];
  const add = (p: string) => { if (p && p.indexOf(':') < 0 && p.indexOf('*') < 0 && found.indexOf(p) < 0) found.push(p); };
  add('/api/health');
  add('/api');
  for (const rel of listFiles(dir)) {
    if (!CODE_EXT.test(rel)) continue;
    let text = '';
    try { text = fs.readFileSync(path.join(dir, rel), 'utf8'); } catch { continue; }
    let m: RegExpExecArray | null;
    const useRe = /\bapp\.use\(\s*['"`](\/[^'"`]*)['"`]\s*,/g;
    while ((m = useRe.exec(text)) !== null) add(m[1]);
    const getRe = /\bapp\.get\(\s*['"`](\/[^'"`]*)['"`]/g;
    while ((m = getRe.exec(text)) !== null) add(m[1]);
    if (found.length >= 14) break;
  }
  return found.slice(0, 14);
}

async function probe(port: number, p: string): Promise<Probe> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 4000);
  try {
    const r = await fetch(`http://localhost:${port}${p}`, { signal: ctl.signal });
    await r.text().catch(() => '');
    return { path: p, status: r.status };
  } catch (e: any) {
    return { path: p, error: e && e.name === 'AbortError' ? 'timeout' : String((e && e.cause && e.cause.code) || (e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

// starts the server, asks it for its pages, and stops it again
async function startAndProbe(dir: string, script: string, paths: string[]) {
  let output = '';
  const state = { exited: false, code: null as number | null };
  const child = spawn(script, [], { cwd: dir, shell: true, env: { ...process.env, BROWSER: 'none' } });
  const collect = (d: Buffer) => {
    output += d.toString();
    if (output.length > 40000) output = output.slice(-20000);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.on('close', (c) => { state.exited = true; state.code = c; });
  child.on('error', (e) => { output += '\n' + e.message; state.exited = true; state.code = 1; });

  let port: number | null = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 15000 && !state.exited && port === null) {
    await sleep(300);
    port = findPort(stripAnsi(output));
  }

  const probes: Probe[] = [];
  if (port !== null && !state.exited) {
    await sleep(600);
    for (const p of ['/'].concat(paths)) probes.push(await probe(port, p));
    await sleep(500); // late error messages
  } else if (!state.exited) {
    await sleep(3000); // no address printed: judge by the output only
  }
  killTree(child);
  await sleep(800); // let the port be released
  return { output: stripAnsi(output).slice(-8000), exited: state.exited, code: state.code, port, probes };
}

// the first error lines of an output, short enough for the progress log
function shortError(out: string): string {
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  const i = lines.findIndex((l) => ERROR_RE.test(l));
  const pick = i >= 0 ? lines.slice(i, i + 3) : lines.slice(-3);
  return pick.join(' | ').slice(0, 300);
}

// problems the AI cannot fix by editing files: report them and stop, instead of wasting AI calls
function environmentProblem(output: string): string | null {
  if (/EADDRINUSE/.test(output)) {
    return 'A port is already in use. Stop the other copy of the app (the Stop button, or close the terminal that runs it) and try again.';
  }
  if (/MongooseServerSelectionError|MongoNetworkError|ECONNREFUSED[^\n]*27017/i.test(output)) {
    return 'The app needs MongoDB and cannot reach it. Start MongoDB, or put a free MongoDB Atlas address in server/.env (MONGO_URI), then run the check again.';
  }
  return null;
}

// the files the AI needs to see: the ones named in the problems, plus the usual entry files
function relevantFiles(root: string, problemText: string): string {
  const all = listFiles(root);
  const picked: string[] = [];
  const add = (rel: string) => { if (picked.indexOf(rel) < 0) picked.push(rel); };

  const tokens = problemText.match(/[\w@.\-/\\]+\.(?:jsx?|tsx?|json|cjs|mjs|html|css)\b/gi) || [];
  for (const t of tokens) {
    const norm = t.replace(/\\/g, '/');
    for (const rel of all) {
      if (rel === norm || rel.endsWith('/' + norm) || norm.endsWith('/' + rel)) add(rel);
    }
  }
  for (const rel of all) {
    if (/(^|\/)package\.json$/.test(rel) || /(^|\/)(server|index|app|main)\.(jsx?|tsx?)$/.test(rel)
      || /(^|\/)vite\.config\.\w+$/.test(rel) || /(^|\/)index\.html$/.test(rel)) add(rel);
  }

  let out = '';
  for (const rel of picked) {
    let text = '';
    try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
    if (text.length > 6000) text = text.slice(0, 6000) + '\n... [file cut]';
    const block = `FILE: ${rel}\n\`\`\`\n${text}\n\`\`\`\n\n`;
    if (out.length + block.length > 16000) continue;
    out += block;
  }
  return out;
}

// POST /api/autofix/run   body: { provider, model, root, maxFixes? }
// Streams one JSON object per line: { type: 'status' | 'done' | 'error', message }
router.post('/run', async (req, res) => {
  const { provider, model, root: rawRoot, maxFixes } = req.body || {};
  if (!provider || !model || !rawRoot) {
    return res.status(400).json({ error: 'provider, model and root are required' });
  }
  const root = path.resolve(String(rawRoot));
  if (!isDir(root)) return res.status(400).json({ error: 'root is not an existing folder' });
  if (findPackageDirs(root).length === 0) return res.status(400).json({ error: 'No package.json found in that folder' });

  res.setHeader('Content-Type', 'application/x-ndjson');
  let aborted = false;
  res.on('close', () => { if (!res.writableEnded) aborted = true; }); // the Stop button closes the connection
  const send = (type: string, message: string) => { if (!aborted) res.write(JSON.stringify({ type, message }) + '\n'); };
  const fixes = Math.min(Number(maxFixes) || 4, 6);
  const needsInstall = new Set<string>();

  try {
    for (let attempt = 0; attempt <= fixes; attempt++) {
      if (aborted) return;
      const problems: string[] = [];
      const summary = { servers: 0, requests: 0, clients: 0 };

      // 1. static checks
      send('status', 'Checking imports, dependencies and scripts…');
      const st = staticCheck(root);
      st.notes.forEach((n) => send('status', n));
      st.changedDirs.forEach((d) => needsInstall.add(d));
      st.problems.forEach((p) => { send('status', `Problem: ${p.slice(0, 200)}`); problems.push(p); });

      // 2. install, start, test (only when the static checks are clean)
      if (problems.length === 0) {
        const dirs = findPackageDirs(root);
        for (const dir of dirs) {
          if (aborted) return;
          const label = toRel(root, dir) || '.';
          let pkg: any = {};
          try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { continue; }

          if (!isDir(path.join(dir, 'node_modules')) || needsInstall.has(dir)) {
            send('status', `Running npm install in ${label} (can take a few minutes)…`);
            const inst = await runCommand(dir, 'npm install', 300000);
            needsInstall.delete(dir);
            if (inst.exitCode !== 0) {
              send('status', `npm install failed in ${label}: ${shortError(inst.output)}`);
              problems.push(`npm install failed in ${label}:\n${inst.output}`);
              continue;
            }
          }

          const scripts = pkg.scripts || {};
          const client = !!(pkg.dependencies && (pkg.dependencies.react || pkg.dependencies.vite)) || !!(pkg.devDependencies && pkg.devDependencies.vite);

          // a website project: build it, which finds every broken import and syntax error
          if (client && scripts.build) {
            send('status', `Building the website in ${label} (npm run build)…`);
            const b = await runCommand(dir, 'npm run build', 180000);
            if (b.exitCode !== 0 || b.timedOut) {
              send('status', `Build failed in ${label}: ${shortError(b.output)}`);
              problems.push(`"npm run build" failed in ${label}:\n${b.output}`);
            } else {
              summary.clients++;
            }
            continue;
          }

          const script = scripts.start ? 'npm start' : (scripts.dev ? 'npm run dev' : '');
          if (!script) continue;
          const startText = String(scripts.start || scripts.dev || '');
          // a root script that only starts the other folders would start the same server a second time
          if (dir === root && dirs.length > 1 && /--prefix|concurrently|\bcd\b|&&/.test(startText)) {
            send('status', `Skipping the start check in ${label}: its script starts the other folders, which are checked on their own.`);
            continue;
          }

          send('status', `Starting "${script}" in ${label} and testing it…`);
          const r = await startAndProbe(dir, script, discoverPaths(root, dir));
          const envProblem = environmentProblem(r.output);
          if (envProblem) {
            send('error', `${label}: ${envProblem}`);
            return res.end();
          }

          const failedProbes = r.probes.filter((p) => (p.status !== undefined && p.status >= 500) || (p.error && p.error !== 'timeout'));
          const crashed = r.exited && r.code !== 0;
          if (crashed || failedProbes.length > 0 || ERROR_RE.test(r.output)) {
            const detail = failedProbes.map((p) => `GET ${p.path} -> ${p.status !== undefined ? p.status : p.error}`).join('\n');
            send('status', `Errors in ${label}: ${failedProbes.length > 0 ? detail.split('\n')[0] : shortError(r.output)}`);
            problems.push(`"${script}" in ${label} failed.${detail ? '\nRequests that failed:\n' + detail : ''}\nOutput:\n${r.output}`);
          } else {
            summary.servers++;
            summary.requests += r.probes.length;
            send('status', r.port !== null
              ? `✔ ${label} started on port ${r.port} and answered ${r.probes.length} request(s) without a server error.`
              : `✔ ${label} started without errors (it printed no port, so no requests were sent).`);
          }
        }
      }

      if (problems.length === 0) {
        send('done', `✔ All checks passed: dependencies complete, ${summary.servers} server(s) started and tested (${summary.requests} request(s)), ${summary.clients} website build(s) succeeded.`);
        return res.end();
      }
      if (attempt === fixes) {
        send('error', `Still failing after ${fixes} fix rounds. Last problems:\n${problems.join('\n\n').slice(0, 1500)}`);
        return res.end();
      }

      // 3. ask the AI to repair what is left
      if (aborted) return;
      send('status', `Asking the AI to fix ${problems.length} problem(s) (round ${attempt + 1} of ${fixes})…`);
      const problemText = problems.join('\n\n').slice(0, 7000);
      const reply = await chat({
        provider,
        model,
        messages: [
          { role: 'system', content: FIX_PROMPT },
          { role: 'user', content: `PROBLEMS:\n${problemText}\n\nRELATED FILES:\n${relevantFiles(root, problemText)}` },
        ],
      });
      const changed = writeFiles(root, parseFiles(reply));
      if (changed.length === 0) {
        send('error', 'The AI did not return any fixed files. Try again or pick a stronger model.');
        return res.end();
      }
      send('status', `Updated: ${changed.join(', ')}`);
      changed.filter((c) => c.endsWith('package.json')).forEach((c) => needsInstall.add(path.dirname(path.resolve(root, c))));
    }
  } catch (err: any) {
    send('error', err.message);
    if (!aborted) res.end();
  }
});

export default router;