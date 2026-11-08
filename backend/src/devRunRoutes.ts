import express from 'express';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { spawn, exec, ChildProcess } from 'child_process';
import { onStopAll, stopEverything } from './procRegistry';

// The ▶ Run button.
// POST /api/devrun/start  body: { root }   streams one JSON object per line: { type: 'status' | 'log' | 'url' | 'error', message }
// POST /api/devrun/stop   body: { root }
//
// What it starts:
//  1. the open folder itself, when its package.json has a "start" or "dev" script
//  2. otherwise every sub-folder that has a package.json with such a script (server/ first, then client/)
//  3. otherwise index.html is opened directly
// It sends ONE "url" event: the website (client) when there is one, else the server address.

const router = express.Router();
const IS_WIN = process.platform === 'win32';

type App = { child: ChildProcess; label: string; url: string | null; exited: boolean; code: number | null; output: string };
const running = new Map<string, App[]>(); // project folder -> apps started for it

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const stripAnsi = (s: string) => s.replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '');
const isDir = (p: string) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p: string) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);

function killTree(child: ChildProcess) {
  if (!child.pid) return;
  if (IS_WIN) exec(`taskkill /pid ${child.pid} /T /F`);
  else child.kill('SIGKILL');
}

function stopRoot(root: string): boolean {
  const list = running.get(root);
  if (!list) return false;
  list.forEach((a) => killTree(a.child));
  running.delete(root);
  return true;
}

function stopAllApps() {
  running.forEach((list) => list.forEach((a) => killTree(a.child)));
  running.clear();
}

onStopAll(stopAllApps);                  // Agent mode asks us to stop before it starts its own servers
process.on('exit', stopAllApps);         // stop every app when the backend stops

// the address the app printed, e.g. "Local: http://localhost:5173/" or "Server running on port 3001".
// "Port 5173 is in use, trying another one" is NOT an address.
function findUrl(text: string): string | null {
  const full = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})/i);
  if (full) return `http://localhost:${full[1]}`;
  const m = text.match(/\b(?:listening|running|started|available)\s+(?:on|at)\s+(?:port\s*:?\s*)?:?(\d{2,5})\b/i);
  return m ? `http://localhost:${m[1]}` : null;
}

function hints(out: string): string {
  const h: string[] = [];
  if (/EADDRINUSE/.test(out)) h.push('A port is already in use: stop the other app (or the terminal running it) first.');
  if (/MongooseServerSelectionError|MongoNetworkError|ECONNREFUSED[^\n]*27017/i.test(out)) h.push('MongoDB is not running on this computer. Start MongoDB or use a project that stores data in a file.');
  const mod = out.match(/Cannot find (?:module|package) '([^'./][^']*)'/);
  if (mod) h.push(`The package "${mod[1]}" is missing: run npm install in that folder.`);
  if (/is not recognized as an internal or external command|command not found/i.test(out)) h.push('A tool is missing: run npm install in that folder (for a Vite site, "vite" must be in its package.json).');
  return h.join(' ');
}

// ---------- what to run ----------
type Target = { dir: string; label: string; script: string; isClient: boolean };

function readPkg(dir: string): any | null {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { return null; }
}

// a Vite site without a "dev" script gets one (AI-written projects sometimes forget it)
function ensureViteScripts(dir: string, pkg: any) {
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (!deps.vite) return;
  pkg.scripts = pkg.scripts || {};
  let changed = false;
  if (!pkg.scripts.dev) { pkg.scripts.dev = 'vite'; changed = true; }
  if (!pkg.scripts.build) { pkg.scripts.build = 'vite build'; changed = true; }
  if (changed) {
    try { fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8'); } catch { /* read-only: the run will report it */ }
  }
}

function describe(root: string, dir: string): Target | null {
  const pkg = readPkg(dir);
  if (!pkg) return null;
  ensureViteScripts(dir, pkg);
  const s = pkg.scripts || {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const isClient = !!(deps.vite || deps['react-scripts']);
  const script = isClient
    ? (s.dev ? 'npm run dev' : (s.start ? 'npm start' : ''))
    : (s.start ? 'npm start' : (s.dev ? 'npm run dev' : ''));
  if (!script) return null;
  const rel = path.relative(root, dir).split(path.sep).join('/');
  return { dir, label: rel || path.basename(root), script, isClient };
}

function subPackageDirs(root: string, dir: string, depth: number): string[] {
  if (depth > 3) return [];
  let found: string[] = [];
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return found; }
  for (const n of names) {
    if (SKIP.has(n) || n.startsWith('.')) continue;
    const p = path.join(dir, n);
    if (!isDir(p)) continue;
    if (isFile(path.join(p, 'package.json'))) found.push(p);
    found = found.concat(subPackageDirs(root, p, depth + 1));
  }
  return found;
}

function makePlan(root: string): Target[] {
  const rootTarget = isFile(path.join(root, 'package.json')) ? describe(root, root) : null;
  if (rootTarget) return [rootTarget];
  const targets = subPackageDirs(root, root, 1)
    .map((d) => describe(root, d))
    .filter((t): t is Target => !!t);
  return targets.sort((a, b) => Number(a.isClient) - Number(b.isClient)); // servers first, websites last
}

// ---------- running ----------
function runInstall(cwd: string, onData: (s: string) => void): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn('npm install', [], { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout?.on('data', (d) => onData(stripAnsi(d.toString())));
    child.stderr?.on('data', (d) => onData(stripAnsi(d.toString())));
    child.on('close', (code) => resolve(code));
    child.on('error', () => resolve(1));
  });
}

router.post('/start', async (req, res) => {
  const rootRaw = req.body && req.body.root;
  if (!rootRaw) return res.status(400).json({ error: 'root is required' });
  const root = path.resolve(String(rootRaw));
  if (!isDir(root)) return res.status(400).json({ error: 'root is not an existing folder' });

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  let ended = false;
  const send = (type: string, message: string) => { if (!ended) res.write(JSON.stringify({ type, message }) + '\n'); };
  const finish = () => { if (!ended) { ended = true; res.end(); } };

  // already running? give the address again
  const old = running.get(root);
  if (old && old.some((a) => !a.exited)) {
    const site = old.filter((a) => a.url && !a.exited);
    if (site.length) { send('url', (site[site.length - 1].url as string)); return finish(); }
    stopRoot(root); // started but never printed an address: start again
  }

  const plan = makePlan(root);
  if (plan.length === 0) {
    const indexHtml = path.join(root, 'index.html');
    if (isFile(indexHtml)) send('url', pathToFileURL(indexHtml).href);
    else send('error', 'Nothing to run: no package.json with a "start" or "dev" script was found in this folder or its sub-folders (server/, client/ ...), and there is no index.html.');
    return finish();
  }

  stopEverything(); // frees ports used by an earlier Run or by Agent mode
  await sleep(500);

  const apps: App[] = [];
  running.set(root, apps);

  try {
    for (const t of plan) {
      if (!isDir(path.join(t.dir, 'node_modules'))) {
        send('status', `${t.label}: running npm install (this can take a few minutes)...`);
        const code = await runInstall(t.dir, (s) => send('log', s));
        if (code !== 0) { send('error', `npm install failed in ${t.label}. See the output above.`); stopRoot(root); return finish(); }
      }

      send('status', `${t.label}: starting ${t.script}`);
      const child = spawn(t.script, [], {
        cwd: t.dir,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'], // no keyboard: a question from a tool ends instead of hanging
        env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0', NO_COLOR: '1' },
      });
      const app: App = { child, label: t.label, url: null, exited: false, code: null, output: '' };
      apps.push(app);

      const onData = (d: Buffer) => {
        const text = stripAnsi(d.toString());
        app.output += text;
        if (app.output.length > 20000) app.output = app.output.slice(-10000);
        if (!app.url) send('log', text);
        if (!app.url) app.url = findUrl(app.output);
      };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('close', (code) => { app.exited = true; app.code = code; });
      child.on('error', (e) => { app.output += '\n' + e.message; app.exited = true; app.code = 1; });

      // wait for the address (a React dev server can take a while)
      const t0 = Date.now();
      while (!ended && !app.exited && !app.url && Date.now() - t0 < 90000) await sleep(250);
      if (!app.exited && app.url) await sleep(1500); // catch a crash right after "listening"

      if (app.exited || !app.url) {
        const why = app.exited
          ? `${t.label} stopped (exit code ${app.code}) before it was ready.`
          : `${t.label} did not print an address within 90 seconds.`;
        send('error', `${why} ${hints(app.output)}`.trim());
        stopRoot(root);
        return finish();
      }
      send('status', `${t.label} is running at ${app.url}`);
    }

    // one address is opened in the browser: the website if there is one, otherwise the server
    let siteIndex = -1;
    plan.forEach((t, i) => { if (t.isClient) siteIndex = i; });
    const open = apps[siteIndex >= 0 ? siteIndex : apps.length - 1];
    send('url', open.url as string);
    finish();
  } catch (err: any) {
    send('error', String((err && err.message) || err));
    stopRoot(root);
    finish();
  }
});

router.post('/stop', (req, res) => {
  const root = path.resolve(String((req.body && req.body.root) || ''));
  const was = stopRoot(root);
  res.json({ success: true, wasRunning: was });
});

export default router;