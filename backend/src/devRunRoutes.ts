import express from 'express';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { spawn, exec, ChildProcess } from 'child_process';

const router = express.Router();

type Running = { child: ChildProcess; url: string | null };
const running = new Map<string, Running>(); // one running app per project folder

const stripAnsi = (s: string) => s.replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '');

function killTree(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === 'win32') exec(`taskkill /pid ${child.pid} /T /F`);
  else child.kill('SIGKILL');
}

// stop every app when the backend stops
process.on('exit', () => { running.forEach(r => killTree(r.child)); });

// finds the address the app printed, e.g. "http://localhost:3001" or "Server running on port 3001"
function findUrl(text: string): string | null {
  const full = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})[^\s"')]*/i);
  if (full) return `http://localhost:${full[1]}`;
  const port =
    text.match(/\blistening on (?:port )?:?(\d{2,5})\b/i) ||
    text.match(/\bport\s*(?:number\s*)?(?:is\s*)?:?\s*(\d{2,5})\b/i);
  return port ? `http://localhost:${port[1]}` : null;
}

function runInstall(cwd: string, onData: (s: string) => void): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn('npm install', [], { cwd, shell: true });
    child.stdout.on('data', d => onData(stripAnsi(d.toString())));
    child.stderr.on('data', d => onData(stripAnsi(d.toString())));
    child.on('close', code => resolve(code));
    child.on('error', () => resolve(1));
  });
}

// POST /api/devrun/start  body: { root }
// Streams one JSON object per line: { type: 'status' | 'log' | 'url' | 'error', message }
router.post('/start', async (req, res) => {
  const rootRaw = req.body && req.body.root;
  if (!rootRaw) return res.status(400).json({ error: 'root is required' });
  const root = path.resolve(String(rootRaw));
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return res.status(400).json({ error: 'root is not an existing folder' });
  }

  res.setHeader('Content-Type', 'application/x-ndjson');
  const send = (type: string, message: string) => res.write(JSON.stringify({ type, message }) + '\n');

  // already running? just give the address again
  const existing = running.get(root);
  if (existing && existing.url) {
    send('url', existing.url);
    return res.end();
  }

  // plain website: no package.json, only index.html -> open the file directly
  const pkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    const indexHtml = path.join(root, 'index.html');
    if (fs.existsSync(indexHtml)) {
      send('url', pathToFileURL(indexHtml).href);
    } else {
      send('error', 'Nothing to run: this folder has no package.json and no index.html.');
    }
    return res.end();
  }

  let pkg: any = {};
  try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); }
  catch (e: any) { send('error', 'package.json is not valid JSON: ' + e.message); return res.end(); }

  const script = pkg.scripts && pkg.scripts.start ? 'npm start' : (pkg.scripts && pkg.scripts.dev ? 'npm run dev' : '');
  if (!script) {
    send('error', 'package.json has no "start" or "dev" script, so there is nothing to run.');
    return res.end();
  }

  try {
    if (!fs.existsSync(path.join(root, 'node_modules'))) {
      send('status', 'Running npm install (this can take a few minutes)...');
      const code = await runInstall(root, (s) => send('log', s));
      if (code !== 0) { send('error', 'npm install failed. See the output above.'); return res.end(); }
    }

    send('status', `Starting: ${script}`);
    const child = spawn(script, [], {
      cwd: root,
      shell: true,
      env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0' },
    });
    const entry: Running = { child, url: null };
    running.set(root, entry);

    let output = '';
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = () => {
      settled = true;
      if (timer) clearTimeout(timer);
      res.end();
    };

    const onData = (d: Buffer) => {
      const text = stripAnsi(d.toString());
      output += text;
      if (output.length > 20000) output = output.slice(-10000);
      if (!settled) send('log', text);
      if (!settled && !entry.url) {
        const url = findUrl(output);
        if (url) { entry.url = url; send('url', url); finish(); }
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.on('close', (code) => {
      running.delete(root);
      if (!settled) {
        const hint = /EADDRINUSE/.test(output) ? ' The port is already in use: stop the other app first.' : '';
        send('error', `The app stopped (exit code ${code}) before it printed an address.${hint}`);
        finish();
      }
    });
    child.on('error', (e) => {
      running.delete(root);
      if (!settled) { send('error', e.message); finish(); }
    });

    // slow starters (React dev servers) get 90 seconds
    timer = setTimeout(() => {
      if (!settled) {
        send('error', 'The app did not print an address within 90 seconds. It may still be starting; check the output.');
        finish();
      }
    }, 90000);
  } catch (err: any) {
    send('error', err.message);
    res.end();
  }
});

// POST /api/devrun/stop  body: { root }
router.post('/stop', (req, res) => {
  const root = path.resolve(String((req.body && req.body.root) || ''));
  const r = running.get(root);
  if (r) {
    killTree(r.child);
    running.delete(root);
  }
  res.json({ success: true, wasRunning: !!r });
});

export default router;