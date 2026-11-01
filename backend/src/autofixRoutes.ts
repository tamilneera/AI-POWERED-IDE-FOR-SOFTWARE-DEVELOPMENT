import express from 'express';
import fs from 'fs';
import path from 'path';
import { spawn, exec } from 'child_process';
import { chat } from './aiService';

const router = express.Router();

const FIX_PROMPT = `You are fixing a Node project that fails to run. You get the error output and the current files.
Return ONLY the files that must change. Write each one as a line "FILE: relative/path" followed by a code block with the FULL new content of that file.
Example:
FILE: server.js
\`\`\`js
console.log("hi");
\`\`\`
Rules: relative paths only, never "..". Write complete files, never snippets or "...". If a dependency is missing, fix package.json. If the frontend and backend disagree on field names or URLs, fix the files so they match. No explanations.`;

const ERROR_RE = /Failed to compile|Cannot find module|SyntaxError|ReferenceError|\w*Error: |EADDRINUSE|ERR_MODULE_NOT_FOUND|npm ERR!|Module not found/i;
const stripAnsi = (s: string) => s.replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '');

type RunResult = { exitCode: number | null; timedOut: boolean; output: string };

function runCommand(cwd: string, command: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    let done = false;
    let timer: NodeJS.Timeout | undefined;

    const child = spawn(command, [], {
      cwd,
      shell: true,
      env: { ...process.env, BROWSER: 'none' },
    });

    const collect = (d: Buffer) => {
      output += d.toString();
      if (output.length > 40000) output = output.slice(-20000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    const kill = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') exec(`taskkill /pid ${child.pid} /T /F`);
      else child.kill('SIGKILL');
    };

    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve({ exitCode: code, timedOut, output: stripAnsi(output).slice(-8000) });
    };

    timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    child.on('close', (code) => finish(code));
    child.on('error', (e) => { output += '\n' + e.message; finish(1); });
  });
}

// "FILE: path" line + code block  ->  [{ path, content }]
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

function findPackageDirs(root: string, depth = 0): string[] {
  if (depth > 3) return [];
  let found: string[] = [];
  if (fs.existsSync(path.join(root, 'package.json'))) found.push(root);
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.')) {
      found = found.concat(findPackageDirs(path.join(root, e.name), depth + 1));
    }
  }
  return found;
}

function readAllFiles(root: string, dir: string = root, acc: string[] = []): string {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'package-lock.json') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      readAllFiles(root, p, acc);
    } else if (fs.statSync(p).size < 30000) {
      const rel = path.relative(root, p).replace(/\\/g, '/');
      acc.push(`FILE: ${rel}\n\`\`\`\n${fs.readFileSync(p, 'utf8')}\n\`\`\``);
    }
  }
  return acc.join('\n\n').slice(0, 30000);
}

// POST /api/autofix/run   body: { provider, model, root, maxFixes? }
// Streams one JSON object per line: { type: 'status' | 'done' | 'error', message }
router.post('/run', async (req, res) => {
  const { provider, model, root: rawRoot, maxFixes } = req.body;
  if (!provider || !model || !rawRoot) {
    return res.status(400).json({ error: 'provider, model and root are required' });
  }
  const root = path.resolve(String(rawRoot));
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return res.status(400).json({ error: 'root is not an existing folder' });
  }
  if (findPackageDirs(root).length === 0) {
    return res.status(400).json({ error: 'No package.json found in that folder' });
  }

  res.setHeader('Content-Type', 'application/x-ndjson');
  const send = (type: string, message: string) => res.write(JSON.stringify({ type, message }) + '\n');
  const fixes = Math.min(Number(maxFixes) || 3, 5);

  try {
    for (let attempt = 0; attempt <= fixes; attempt++) {
      const problems: string[] = [];

      for (const dir of findPackageDirs(root)) {
        const label = path.relative(root, dir) || '.';

        if (!fs.existsSync(path.join(dir, 'node_modules'))) {
          send('status', `Running npm install in ${label} (can take a few minutes)...`);
          const inst = await runCommand(dir, 'npm install', 300000);
          if (inst.exitCode !== 0) {
            problems.push(`npm install failed in ${label}:\n${inst.output}`);
            continue;
          }
        }

        let pkg: any = {};
        try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); }
        catch (e: any) { problems.push(`package.json in ${label} is not valid JSON: ${e.message}`); continue; }

        const script = pkg.scripts && pkg.scripts.start ? 'npm start' : (pkg.scripts && pkg.scripts.dev ? 'npm run dev' : '');
        if (!script) continue;

        send('status', `Starting "${script}" in ${label} (20 second check)...`);
        const run = await runCommand(dir, script, 20000);
        const crashed = !run.timedOut && run.exitCode !== 0;
        if (crashed || ERROR_RE.test(run.output)) {
          problems.push(`"${script}" in ${label} reported errors:\n${run.output}`);
        }
      }

      if (problems.length === 0) {
        send('done', 'App starts without errors. Run "npm start" in a terminal and open it in the browser.');
        return res.end();
      }
      if (attempt === fixes) {
        send('error', `Still failing after ${fixes} fix attempts. Last errors:\n${problems.join('\n\n').slice(0, 1500)}`);
        return res.end();
      }

      send('status', `Found errors. Asking the AI to fix them (attempt ${attempt + 1} of ${fixes})...`);
      const reply = await chat({
        provider,
        model,
        messages: [
          { role: 'system', content: FIX_PROMPT },
          { role: 'user', content: `ERRORS:\n${problems.join('\n\n')}\n\nCURRENT FILES:\n${readAllFiles(root)}` },
        ],
      });
      const changed = writeFiles(root, parseFiles(reply));
      if (changed.length === 0) {
        send('error', 'The AI did not return any fixed files. Try again or pick a stronger model.');
        return res.end();
      }
      send('status', `Updated: ${changed.join(', ')}`);

      // a changed package.json means dependencies changed: reinstall
      if (changed.some(c => c.endsWith('package.json'))) {
        for (const d of findPackageDirs(root)) {
          fs.rmSync(path.join(d, 'node_modules'), { recursive: true, force: true });
        }
      }
    }
  } catch (err: any) {
    send('error', err.message);
    res.end();
  }
});

export default router;