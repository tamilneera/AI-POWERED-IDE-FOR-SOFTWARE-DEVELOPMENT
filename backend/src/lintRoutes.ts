import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

const router = express.Router();

type Diagnostic = { line: number; column: number; message: string; severity: 'error' | 'warning' };
type CheckResult = { available: boolean; reason?: string; diagnostics: Diagnostic[] };
type ToolResult = { found: boolean; code: number | null; stdout: string; stderr: string };

// Runs the first command from the list that exists on this computer.
// found=false means none of them is installed.
function runTool(
  commands: string[],
  args: string[],
  opts: { input?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}
): Promise<ToolResult> {
  const tryNext = (i: number): Promise<ToolResult> =>
    new Promise((resolve) => {
      if (i >= commands.length) return resolve({ found: false, code: null, stdout: '', stderr: '' });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const child = spawn(commands[i], args, { windowsHide: true, env: opts.env || process.env });
      const timer = setTimeout(() => { child.kill(); }, opts.timeoutMs ?? 10000);

      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('error', (err: any) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        if (err.code === 'ENOENT') resolve(tryNext(i + 1));
        else resolve({ found: true, code: 1, stdout, stderr: err.message });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        // the Windows "python" shortcut to the Microsoft Store is not a real Python
        if (/Python was not found|Microsoft Store/i.test(stderr)) resolve(tryNext(i + 1));
        else resolve({ found: true, code, stdout, stderr });
      });
      if (opts.input !== undefined) {
        child.stdin.on('error', () => { /* tool exited early */ });
        child.stdin.end(opts.input);
      }
    });
  return tryNext(0);
}

const PY_COMMANDS = ['python', 'py', 'python3'];
const PY_ENV = { ...process.env, PYTHONIOENCODING: 'utf-8' };

const PY_SYNTAX_SCRIPT = `
import ast, sys, json
src = sys.stdin.read()
try:
    ast.parse(src)
    print(json.dumps({"ok": True}))
except SyntaxError as e:
    print(json.dumps({"ok": False, "line": e.lineno or 1, "column": e.offset or 1, "message": e.msg}))
`;

export async function checkPython(content: string): Promise<CheckResult> {
  // 1) syntax errors (needs only Python itself)
  const syntax = await runTool(PY_COMMANDS, ['-c', PY_SYNTAX_SCRIPT], { input: content, env: PY_ENV });
  if (!syntax.found) {
    return { available: false, reason: 'Python was not found. Install Python and add it to PATH to see Python errors.', diagnostics: [] };
  }
  try {
    const parsed = JSON.parse(syntax.stdout.trim().split('\n').pop() || '{}');
    if (parsed.ok === false) {
      return {
        available: true,
        diagnostics: [{ line: parsed.line, column: parsed.column, message: parsed.message, severity: 'error' }],
      };
    }
  } catch {
    return { available: true, diagnostics: [] };
  }

  // 2) undefined names, unused imports (optional: pip install pyflakes)
  const flakes = await runTool(PY_COMMANDS, ['-m', 'pyflakes'], { input: content, env: PY_ENV });
  if (!flakes.found || /No module named pyflakes/i.test(flakes.stderr)) {
    return { available: true, diagnostics: [] };
  }
  const diagnostics: Diagnostic[] = [];
  for (const line of flakes.stdout.split(/\r?\n/)) {
    const m = line.match(/^<stdin>:(\d+)(?::(\d+))?:? (.*)$/);
    if (!m) continue;
    diagnostics.push({
      line: Number(m[1]),
      column: m[2] ? Number(m[2]) : 1,
      message: m[3],
      severity: /undefined name/i.test(m[3]) ? 'error' : 'warning',
    });
  }
  return { available: true, diagnostics };
}

export async function checkJava(content: string, filePath?: string): Promise<CheckResult> {
  // javac needs the file to be named after the public class
  const named = content.match(/public\s+(?:final\s+|abstract\s+)*(?:class|interface|enum|record)\s+(\w+)/);
  const className = named ? named[1] : 'Main';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ide-lint-'));
  const file = path.join(dir, `${className}.java`);
  try {
    fs.writeFileSync(file, content, 'utf8');
    const args = ['-encoding', 'UTF-8', '-d', dir];
    // let javac find other classes that live in the same folder as the real file
    if (filePath && fs.existsSync(path.dirname(filePath))) args.push('-sourcepath', path.dirname(filePath));
    args.push(file);

    const res = await runTool(['javac'], args, { timeoutMs: 15000 });
    if (!res.found) {
      return { available: false, reason: 'javac was not found. Install a JDK and add it to PATH to see Java errors.', diagnostics: [] };
    }

    const lines = res.stderr.split(/\r?\n/);
    const diagnostics: Diagnostic[] = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(.*\.java):(\d+): (error|warning): (.*)$/);
      if (!m) continue;
      if (path.resolve(m[1]) !== path.resolve(file)) continue; // errors of other files are not shown here
      let column = 1;
      const caret = lines[i + 2];
      if (caret && /^\s*\^\s*$/.test(caret)) column = caret.indexOf('^') + 1;
      let message = m[4];
      const extra = lines[i + 3];
      if (extra && /^\s+symbol:/.test(extra)) message += ' (' + extra.trim() + ')';
      diagnostics.push({ line: Number(m[2]), column, message, severity: m[3] as 'error' | 'warning' });
    }
    return { available: true, diagnostics };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// POST /api/lint/check   body: { language: 'python' | 'java', content, path? }
router.post('/check', async (req, res) => {
  const { language, content, path: filePath } = req.body || {};
  if (typeof content !== 'string' || !language) {
    return res.status(400).json({ error: 'language and content are required' });
  }
  if (content.length > 200000) return res.json({ available: true, diagnostics: [] });
  try {
    if (language === 'python') return res.json(await checkPython(content));
    if (language === 'java') return res.json(await checkJava(content, filePath));
    return res.json({ available: true, diagnostics: [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;