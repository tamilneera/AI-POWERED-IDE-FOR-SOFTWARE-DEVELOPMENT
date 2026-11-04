import express from 'express';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import db from './db';
import { chat } from './aiService';
import { checkPython, checkJava } from './lintRoutes';

const router = express.Router();

// ---------- history table (with a safe upgrade for older versions) ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS quality_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT,
    file_name TEXT,
    language TEXT,
    score INTEGER,
    lines INTEGER,
    functions INTEGER,
    avg_complexity REAL,
    max_complexity INTEGER,
    duplication REAL,
    issue_count INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
{
  const existing = (db.prepare('PRAGMA table_info(quality_runs)').all() as any[]).map((c) => c.name);
  const extra: [string, string][] = [
    ['security_count', 'INTEGER'],
    ['ai_status', 'TEXT'],
    ['static_ms', 'INTEGER'],
    ['ai_ms', 'INTEGER'],
    ['total_ms', 'INTEGER'],
  ];
  for (const [name, type] of extra) {
    if (!existing.includes(name)) db.exec(`ALTER TABLE quality_runs ADD COLUMN ${name} ${type}`);
  }
}

// ---------- types ----------
type Severity = 'error' | 'warning' | 'info';
type Kind = 'blank' | 'comment' | 'code';
type Category = 'security' | 'bug' | 'performance' | 'smell' | 'style';
type Issue = {
  source: 'static' | 'ai';
  tool?: string; // rules | eslint | python | javac (static findings only)
  line: number;
  endLine?: number; // last line of the function, for function-level issues
  severity: Severity;
  category: Category;
  message: string;
  suggestion?: string;
  // verified: found by a rule or a tool. confirmed: AI finding backed by a tool. unverified: AI only.
  status?: 'verified' | 'confirmed' | 'unverified';
  confirmedByAi?: boolean;
};
type FnInfo = { name: string; start: number; end: number; length: number; complexity: number; nesting: number };
type Msg = { role: 'user' | 'assistant' | 'system'; content: string };

const SUPPORTED = ['python', 'java', 'javascript', 'typescript'];
const CATEGORIES: Category[] = ['security', 'bug', 'performance', 'smell', 'style'];
const MAX_AI_CHARS = 12000;
const AI_TIMEOUT_MS = 150000;
const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
const PENALTY: Record<Severity, number> = { error: 8, warning: 4, info: 1 };
const CONTROL = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'else', 'new', 'try', 'do', 'synchronized', 'function']);

const JS_FUNCTION = /\bfunction\s*\*?\s*(\w+)?\s*\(/;
const JS_ARROW = /\b(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*(?::\s*[\w<>\[\]|. ]+)?\s*=>/;
const JS_METHOD = /^\s*(?:(?:public|private|protected|static|async|get|set|readonly)\s+)*(\w+)\s*\([^)]*\)\s*(?::\s*[\w<>\[\]|. ]+)?\s*\{\s*$/;
const JAVA_METHOD = /^\s*(?:(?:public|private|protected|static|final|abstract|synchronized|native|default)\s+)*[\w<>\[\],.?]+(?:\s*<[^>]*>)?\s+(\w+)\s*\([^;{}]*\)\s*(?:throws\s+[\w.,\s]+)?\s*\{?\s*$/;
const JAVA_CTOR = /^\s*(?:public|private|protected)\s+(\w+)\s*\([^;{}]*\)\s*(?:throws\s+[\w.,\s]+)?\s*\{?\s*$/;
const SQL_WORDS = /\b(?:SELECT\s+[\w*,.\s]+\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timed out')), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

// ---------- text helpers ----------
function indentOf(line: string): number {
  const m = line.match(/^\s*/);
  return m ? m[0].length : 0;
}

// removes string contents and line comments so keywords and braces inside them are not counted
function stripCode(line: string, lang: string): string {
  let s = line.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, '""');
  s = lang === 'python' ? s.replace(/#.*$/, '') : s.replace(/\/\/.*$/, '');
  return s;
}

// marks every line as blank / comment / code and gives a "clean" version of the code lines
function preprocess(lines: string[], lang: string): { clean: string[]; kind: Kind[] } {
  const clean: string[] = [];
  const kind: Kind[] = [];
  let inBlock = false;
  let inDoc = false;
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) { clean.push(''); kind.push('blank'); continue; }

    if (lang === 'python') {
      const triples = (t.match(/"""|'''/g) || []).length;
      if (inDoc) {
        clean.push(''); kind.push('comment');
        if (triples % 2 === 1) inDoc = false;
        continue;
      }
      if (/^[rRbBuU]?("""|''')/.test(t)) {
        clean.push(''); kind.push('comment');
        if (triples % 2 === 1) inDoc = true;
        continue;
      }
      if (t.startsWith('#')) { clean.push(''); kind.push('comment'); continue; }
    } else {
      if (inBlock) {
        clean.push(''); kind.push('comment');
        if (t.includes('*/')) inBlock = false;
        continue;
      }
      if (t.startsWith('/*')) {
        clean.push(''); kind.push('comment');
        if (!t.includes('*/')) inBlock = true;
        continue;
      }
      if (t.startsWith('//')) { clean.push(''); kind.push('comment'); continue; }
    }
    kind.push('code');
    clean.push(stripCode(raw, lang));
  }
  return { clean, kind };
}

// cyclomatic complexity: 1 + number of decision points
function complexityOf(text: string, lang: string): number {
  const re = lang === 'python'
    ? /\b(if|elif|for|while|except|and|or|case)\b/g
    : /\b(if|for|while|case|catch)\b|&&|\|\||\?(?![.?:])/g;
  return 1 + (text.match(re) || []).length;
}

// how many blocks sit inside each other inside one function
function nestingOf(lines: string[], clean: string[], kind: Kind[], start: number, end: number, lang: string): number {
  if (lang === 'python') {
    let first = start;
    while (first < end && !/:\s*$/.test(clean[first])) first++; // skip a multi-line signature
    const indents: number[] = [];
    for (let i = first + 1; i <= end; i++) if (kind[i] === 'code') indents.push(indentOf(lines[i]));
    if (indents.length === 0) return 0;
    const base = Math.min(...indents);
    const diffs = indents.map(x => x - base).filter(x => x > 0);
    const unit = diffs.length ? Math.min(...diffs) : 4;
    return Math.round(Math.max(...indents.map(x => x - base)) / unit);
  }
  let depth = 0;
  let max = 0;
  for (let i = start; i <= end; i++) {
    for (const ch of clean[i]) {
      if (ch === '{') { depth++; if (depth > max) max = depth; }
      else if (ch === '}') depth--;
    }
  }
  return Math.max(0, max - 1);
}

function buildFunction(
  name: string, start: number, end: number,
  lines: string[], clean: string[], kind: Kind[], lang: string
): FnInfo {
  const body = clean.slice(start, end + 1).join('\n');
  return {
    name,
    start: start + 1,
    end: end + 1,
    length: end - start + 1,
    complexity: complexityOf(body, lang),
    nesting: nestingOf(lines, clean, kind, start, end, lang),
  };
}

function findFunctions(lines: string[], clean: string[], kind: Kind[], lang: string): FnInfo[] {
  const fns: FnInfo[] = [];

  if (lang === 'python') {
    for (let i = 0; i < lines.length; i++) {
      if (kind[i] !== 'code') continue;
      const m = clean[i].match(/^(\s*)(?:async\s+)?def\s+(\w+)/);
      if (!m) continue;
      const indent = m[1].length;
      let end = i;
      for (let j = i + 1; j < lines.length; j++) {
        if (kind[j] !== 'code') continue;
        if (indentOf(lines[j]) <= indent) break;
        end = j;
      }
      fns.push(buildFunction(m[2], i, end, lines, clean, kind, lang));
    }
    return fns;
  }

  for (let i = 0; i < lines.length; i++) {
    if (kind[i] !== 'code') continue;
    const line = clean[i];
    let name: string | null = null;

    if (lang === 'java') {
      const m = line.match(JAVA_METHOD) || line.match(JAVA_CTOR);
      if (m && !CONTROL.has(m[1])) name = m[1];
    } else {
      const f = line.match(JS_FUNCTION);
      if (f) {
        name = f[1] || '(anonymous)';
      } else {
        const a = line.match(JS_ARROW);
        if (a) {
          name = a[1];
        } else {
          const mm = line.match(JS_METHOD);
          if (mm && !CONTROL.has(mm[1])) name = mm[1];
        }
      }
    }
    if (!name) continue;

    // find the closing brace that matches the first opening brace
    let depth = 0;
    let started = false;
    let end = i;
    outer: for (let j = i; j < lines.length; j++) {
      for (const ch of clean[j]) {
        if (ch === '{') { depth++; started = true; }
        else if (ch === '}') depth--;
        if (started && depth === 0) { end = j; break outer; }
      }
      if (!started && j >= i + 2) { end = i; break; } // no body (one-liner or abstract)
      if (j === lines.length - 1) end = j;
    }
    fns.push(buildFunction(name, i, end, lines, clean, kind, lang));
  }
  return fns;
}

// share of code lines that are repeated identical lines
function duplicationOf(lines: string[], kind: Kind[]): { percent: number; topLine: number; topText: string; topCount: number } {
  const seen = new Map<string, number[]>();
  let codeLines = 0;
  lines.forEach((raw, i) => {
    if (kind[i] !== 'code') return;
    codeLines++;
    const t = raw.trim();
    if (t.length < 25) return;
    if (/^(import|from|using|package|#include)\b/.test(t)) return;
    if (/^[\]\[(){};,]+$/.test(t)) return;
    const list = seen.get(t) || [];
    list.push(i + 1);
    seen.set(t, list);
  });
  let dup = 0;
  let topText = '';
  let topLine = 1;
  let topCount = 0;
  seen.forEach((list, text) => {
    if (list.length >= 2) {
      dup += list.length;
      if (list.length > topCount) { topCount = list.length; topText = text; topLine = list[0]; }
    }
  });
  const percent = codeLines ? Math.round((dup / codeLines) * 1000) / 10 : 0;
  return { percent, topLine, topText, topCount };
}

function looksLikeSqlConcat(raw: string): boolean {
  if (!SQL_WORDS.test(raw)) return false;
  return (
    /["'`][^"'`]*["'`]\s*\+\s*\w/.test(raw) ||  // "..." + variable
    /\w\s*\+\s*["'`]/.test(raw) ||               // variable + "..."
    /`[^`]*\$\{/.test(raw) ||                    // `...${x}...`
    /\bf["'][^"']*\{/.test(raw) ||               // python f-string
    /%s[^"']*["']\s*%/.test(raw)                 // "..." % (...)
  );
}

// ---------- rule-based static analysis ----------
function analyze(code: string, lang: string) {
  const lines = code.replace(/\r\n/g, '\n').split('\n');
  const { clean, kind } = preprocess(lines, lang);
  const functions = findFunctions(lines, clean, kind, lang);
  const issues: Issue[] = [];

  // rule hits are capped so one problem repeated 200 times does not flood the list
  const CAP = 5;
  const hits: Record<string, number> = {};
  const firstLine: Record<string, number> = {};
  const labels: Record<string, string> = {};
  const labelCategory: Record<string, Category> = {};
  const add = (rule: string, issue: Omit<Issue, 'source'>) => {
    hits[rule] = (hits[rule] || 0) + 1;
    if (hits[rule] === 1) { firstLine[rule] = issue.line; labels[rule] = issue.message; labelCategory[rule] = issue.category; }
    if (hits[rule] <= CAP) issues.push({ source: 'static', ...issue });
  };

  const isJs = lang === 'javascript' || lang === 'typescript';
  const braceStack: boolean[] = [];   // true = this "{" opens a loop body
  const loopIndents: number[] = [];   // python: indentation of the open loops

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const c = clean[i];
    const ln = i + 1;

    if (raw.length > 120) {
      add('long-line', { line: ln, severity: 'info', category: 'style', message: `Line is ${raw.length} characters long (over 120)`, suggestion: 'Split it into shorter lines.' });
    }
    if (/\b(TODO|FIXME|HACK|XXX)\b/.test(raw)) {
      add('todo', { line: ln, severity: 'info', category: 'smell', message: 'Unfinished work marked in a comment (TODO / FIXME)', suggestion: 'Finish it or move it to an issue tracker.' });
    }
    if (kind[i] !== 'code') continue;

    // ----- performance: nested loops and await inside loops -----
    if (lang === 'python') {
      const ind = indentOf(raw);
      while (loopIndents.length && ind <= loopIndents[loopIndents.length - 1]) loopIndents.pop();
      if (/^\s*(for|while)\b.*:\s*$/.test(c)) {
        loopIndents.push(ind);
        if (loopIndents.length >= 3) {
          add('nested-loops', { line: ln, severity: 'warning', category: 'performance', message: `Loops nested ${loopIndents.length} levels deep (can be very slow on large data)`, suggestion: 'Use a dict or set for lookups, or restructure to reduce the nesting.' });
        }
      }
      if (/for\s+\w+\s+in\s+range\(\s*len\(/.test(c)) {
        add('range-len', { line: ln, severity: 'info', category: 'style', message: 'Looping over range(len(x)) is harder to read than needed', suggestion: 'Use for item in x, or enumerate(x) when you need the index.' });
      }
    } else {
      const isLoop = /\b(for|while)\b/.test(c) && !/^\s*\}\s*while/.test(c);
      const loopsOpen = braceStack.filter(Boolean).length;
      if (isLoop && loopsOpen + 1 >= 3) {
        add('nested-loops', { line: ln, severity: 'warning', category: 'performance', message: `Loops nested ${loopsOpen + 1} levels deep (can be very slow on large data)`, suggestion: 'Use a Map or Set for lookups, or restructure to reduce the nesting.' });
      }
      if (isJs && loopsOpen >= 1 && /\bawait\b/.test(c)) {
        add('await-loop', { line: ln, severity: 'info', category: 'performance', message: 'await inside a loop runs the calls one after another', suggestion: 'If the calls are independent, start them together with Promise.all.' });
      }
      let first = true;
      for (const ch of c) {
        if (ch === '{') { braceStack.push(first && isLoop); first = false; }
        else if (ch === '}') braceStack.pop();
      }
    }

    // ----- security -----
    if (/(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["'][^"']{6,}["']/i.test(raw)) {
      add('secret', { line: ln, severity: 'warning', category: 'security', message: 'Possible hardcoded secret (password, key or token)', suggestion: 'Read it from an environment variable or a .env file instead.' });
    }
    if (looksLikeSqlConcat(raw)) {
      add('sql-inject', { line: ln, severity: 'error', category: 'security', message: 'Possible SQL injection: the query is built by joining text', suggestion: 'Use parameterized queries (placeholders) instead of joining strings.' });
    }
    if (/\b(?:createHash)\(\s*["'](?:md5|sha1)["']/i.test(raw) || /hashlib\.(?:md5|sha1)\(/.test(raw) || /MessageDigest\.getInstance\(\s*"(?:MD5|SHA-?1)"/i.test(raw)) {
      add('weak-hash', { line: ln, severity: 'warning', category: 'security', message: 'Weak hash algorithm (MD5 or SHA-1)', suggestion: 'Use SHA-256 or better. For passwords use bcrypt or argon2.' });
    }
    if (/rejectUnauthorized\s*:\s*false|verify\s*=\s*False|NODE_TLS_REJECT_UNAUTHORIZED/.test(raw)) {
      add('tls-off', { line: ln, severity: 'warning', category: 'security', message: 'Certificate checking is turned off', suggestion: 'Keep TLS verification on; fix the certificate instead.' });
    }
    if (/["']http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/.test(raw)) {
      add('http-url', { line: ln, severity: 'info', category: 'security', message: 'Unencrypted http:// address', suggestion: 'Use https:// for anything outside your own machine.' });
    }

    // ----- language specific rules -----
    if (isJs) {
      if (/\bconsole\.(log|debug)\(/.test(c)) {
        add('debug', { line: ln, severity: 'info', category: 'style', message: 'Leftover debug output (console.log)', suggestion: 'Remove it before sharing the code.' });
      }
      // "== null" is a common, deliberate check for both null and undefined, so it is not flagged
      if (/[^=!<>]==[^=]|!=[^=]/.test(c) && !/[!=]=\s*null\b/.test(c)) {
        add('loose-eq', { line: ln, severity: 'warning', category: 'bug', message: 'Loose equality (== or !=) can give surprising results', suggestion: 'Use === and !== instead.' });
      }
      if (/^\s*var\s/.test(c)) {
        add('var', { line: ln, severity: 'info', category: 'style', message: 'var is function-scoped and easy to misuse', suggestion: 'Use let or const.' });
      }
      if (/\.forEach\(\s*async\b/.test(c)) {
        add('foreach-async', { line: ln, severity: 'warning', category: 'bug', message: 'forEach does not wait for an async callback', suggestion: 'Use for...of with await, or Promise.all with map.' });
      }
      if (/\beval\(/.test(c)) {
        add('eval', { line: ln, severity: 'error', category: 'security', message: 'eval() runs arbitrary code', suggestion: 'Avoid eval; parse the data or call a function instead.' });
      }
      if (/\.innerHTML\s*=|dangerouslySetInnerHTML/.test(c)) {
        add('innerhtml', { line: ln, severity: 'warning', category: 'security', message: 'Raw HTML insertion can cause XSS if the text is not escaped', suggestion: 'Use textContent, or escape the text first.' });
      }
      if (/\b(?:exec|execSync)\(\s*(?:`[^`]*\$\{|["'][^"']*["']\s*\+|\w+\s*\+)/.test(raw)) {
        add('cmd-inject', { line: ln, severity: 'error', category: 'security', message: 'Shell command built from variable text (command injection risk)', suggestion: 'Use execFile or spawn with an argument list, and validate the input.' });
      }
      if (/JSON\.parse\(\s*JSON\.stringify\(/.test(c)) {
        add('json-clone', { line: ln, severity: 'info', category: 'performance', message: 'Copying an object with JSON.parse(JSON.stringify(...)) is slow', suggestion: 'Use structuredClone().' });
      }
    }

    if (lang === 'python') {
      if (/^\s*print\(/.test(c)) {
        add('debug', { line: ln, severity: 'info', category: 'style', message: 'Leftover debug output (print)', suggestion: 'Remove it or use the logging module.' });
      }
      if (/^\s*except\s*:/.test(c)) {
        add('bare-except', { line: ln, severity: 'warning', category: 'bug', message: 'Bare except hides every error, even Ctrl+C', suggestion: 'Catch a specific exception, for example except ValueError.' });
      }
      if (/\bdef\s+\w+\(.*=\s*(\[\]|\{\})/.test(c)) {
        add('mutable-default', { line: ln, severity: 'warning', category: 'bug', message: 'Mutable default argument is shared between calls', suggestion: 'Use None as the default and create the list or dict inside the function.' });
      }
      if (/\b(eval|exec)\(/.test(c)) {
        add('eval', { line: ln, severity: 'warning', category: 'security', message: 'eval()/exec() run arbitrary code', suggestion: 'Avoid them; use ast.literal_eval or real functions.' });
      }
      if (/\bos\.system\(/.test(c) || /shell\s*=\s*True/.test(c)) {
        add('cmd-inject', { line: ln, severity: 'warning', category: 'security', message: 'Shell command execution can allow command injection', suggestion: 'Use subprocess.run([...]) with a list and shell=False.' });
      }
      if (/\bpickle\.loads?\(/.test(c) || /\byaml\.load\((?![^)]*Loader)/.test(c)) {
        add('unsafe-load', { line: ln, severity: 'warning', category: 'security', message: 'Unsafe loading of data (pickle or yaml.load) can run code', suggestion: 'Use json, or yaml.safe_load.' });
      }
    }

    if (lang === 'java') {
      if (/System\.out\.print/.test(c)) {
        add('debug', { line: ln, severity: 'info', category: 'style', message: 'Leftover debug output (System.out)', suggestion: 'Remove it or use a logger.' });
      }
      if (/\.printStackTrace\(\)/.test(c)) {
        add('stacktrace', { line: ln, severity: 'info', category: 'smell', message: 'printStackTrace() is not real error handling', suggestion: 'Log the error or handle it properly.' });
      }
      if (/Runtime\.getRuntime\(\)\.exec\(/.test(c)) {
        add('cmd-inject', { line: ln, severity: 'warning', category: 'security', message: 'Running shell commands can allow command injection', suggestion: 'Use ProcessBuilder with an argument list and validate the input.' });
      }
    }

    if (lang !== 'python') {
      if (/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(c)) {
        add('empty-catch', { line: ln, severity: 'warning', category: 'bug', message: 'Empty catch block swallows errors', suggestion: 'Handle or at least log the error.' });
      } else if (/catch\s*(\([^)]*\))?\s*\{\s*$/.test(c)) {
        let j = i + 1;
        while (j < lines.length && kind[j] !== 'code') j++;
        if (j < lines.length && clean[j].trim() === '}') {
          add('empty-catch', { line: ln, severity: 'warning', category: 'bug', message: 'Empty catch block swallows errors', suggestion: 'Handle or at least log the error.' });
        }
      }
    }
  }

  Object.keys(hits).forEach((rule) => {
    if (hits[rule] > CAP) {
      issues.push({
        source: 'static', line: firstLine[rule], severity: 'info', category: labelCategory[rule],
        message: `${hits[rule] - CAP} more like this: ${labels[rule]}`,
      });
    }
  });

  for (const f of functions) {
    if (f.length > 50) {
      issues.push({
        source: 'static', line: f.start, endLine: f.end, severity: f.length > 100 ? 'error' : 'warning', category: 'smell', 
        message: `Function ${f.name} is ${f.length} lines long`,
        suggestion: 'Split it into smaller functions that each do one thing.',
      });
    }
    if (f.complexity > 10) {
      issues.push({
        source: 'static', line: f.start, endLine: f.end, severity: f.complexity > 20 ? 'error' : 'warning', category: 'smell',
        message: `Function ${f.name} has cyclomatic complexity ${f.complexity} (above 10)`,
        suggestion: 'Reduce the number of branches: use early returns or extract helper functions.',
       
      });
    }
    if (f.nesting > 4) {
      issues.push({
        source: 'static', line: f.start, endLine: f.end, severity: 'warning', category: 'smell',
        message: `Function ${f.name} nests blocks ${f.nesting} levels deep`,
        suggestion: 'Flatten it with early returns or helper functions.', 
      });
    }  
  }

  const dup = duplicationOf(lines, kind);
  if (dup.percent >= 15) {
    issues.push({
      source: 'static', line: dup.topLine, severity: 'warning', category: 'smell',
      message: `${dup.percent}% of the code is repeated lines (for example "${dup.topText.slice(0, 50)}" appears ${dup.topCount} times)`,
      suggestion: 'Move repeated code into a function.',
    });
  }

  issues.forEach((i) => { i.tool = 'rules'; i.status = 'verified'; });

  const codeLines = kind.filter(k => k === 'code').length;
  const commentLines = kind.filter(k => k === 'comment').length;
  const blankLines = kind.filter(k => k === 'blank').length;
  const complexities = functions.map(f => f.complexity);
  const avgComplexity = complexities.length
    ? Math.round((complexities.reduce((a, b) => a + b, 0) / complexities.length) * 10) / 10
    : 0;
  const maxComplexity = complexities.length ? Math.max(...complexities) : 0;

  return {
    issues,
    kind,
    metrics: {
      lines: lines.length,
      codeLines,
      commentLines,
      blankLines,
      functions: functions.length,
      avgComplexity,
      maxComplexity,
      longestFunction: functions.length ? Math.max(...functions.map(f => f.length)) : 0,
      maxNesting: functions.length ? Math.max(...functions.map(f => f.nesting)) : 0,
      duplication: dup.percent,
    },
    topFunctions: [...functions].sort((a, b) => b.complexity - a.complexity).slice(0, 8),
  };
}

// the score uses only rule and tool findings, so the same file always gets the same score
function computeScore(issues: Issue[], duplication: number, avgComplexity: number) {
  let penalty = 0;
  for (const i of issues) penalty += PENALTY[i.severity];
  penalty = Math.min(70, penalty);
  const dupPenalty = Math.min(10, duplication / 3);
  const complexityPenalty = Math.min(10, Math.max(0, avgComplexity - 5) * 2);
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty - dupPenalty - complexityPenalty)));
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
  return { score, grade };
}

// ---------- real tools: ESLint (JavaScript), Python checker, javac ----------
const JS_GLOBAL_NAMES = [
  'console', 'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'fetch', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'setImmediate', 'requestAnimationFrame', 'cancelAnimationFrame', 'alert', 'confirm',
  'prompt', 'process', 'require', 'module', 'exports', '__dirname', '__filename', 'Buffer', 'global', 'globalThis', 'URL',
  'URLSearchParams', 'FormData', 'Headers', 'Request', 'Response', 'AbortController', 'Event', 'CustomEvent',
  'XMLHttpRequest', 'WebSocket', 'Blob', 'File', 'FileReader', 'TextEncoder', 'TextDecoder', 'performance',
  'structuredClone', 'queueMicrotask', 'atob', 'btoa', 'crypto', 'history', 'location', 'MutationObserver',
  'IntersectionObserver', 'ResizeObserver', 'Image', 'Audio', 'HTMLElement', 'Node', 'Element', 'MouseEvent',
  'KeyboardEvent', 'getComputedStyle', 'matchMedia', 'Intl',
];

const ESLINT_RULES: Record<string, { severity: Severity; category: Category; suggestion: string }> = {
  'no-undef': { severity: 'error', category: 'bug', suggestion: 'Declare it, import it, or fix the spelling.' },
  'no-unused-vars': { severity: 'info', category: 'smell', suggestion: 'Remove it, or use it.' },
  'no-unreachable': { severity: 'warning', category: 'bug', suggestion: 'Remove the code after return, throw or break.' },
  'no-dupe-keys': { severity: 'error', category: 'bug', suggestion: 'Remove or rename the repeated key.' },
  'no-const-assign': { severity: 'error', category: 'bug', suggestion: 'Use let if the value must change.' },
  'no-redeclare': { severity: 'warning', category: 'bug', suggestion: 'Declare the variable only once.' },
  'no-func-assign': { severity: 'error', category: 'bug', suggestion: 'Do not overwrite a function; use another name.' },
  'use-isnan': { severity: 'error', category: 'bug', suggestion: 'Use Number.isNaN(x) to test for NaN.' },
  'no-self-assign': { severity: 'warning', category: 'bug', suggestion: 'Remove the useless assignment.' },
};

function runEslint(code: string): { issues: Issue[]; note?: string } {
  let LinterClass: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    LinterClass = require('eslint').Linter;
  } catch {
    return { issues: [], note: 'ESLint is not installed (run "npm install eslint@9" in the backend folder), so that check was skipped.' };
  }
  try {
    const globals: Record<string, string> = {};
    JS_GLOBAL_NAMES.forEach((n) => { globals[n] = 'readonly'; });
    const rules: Record<string, string> = {};
    Object.keys(ESLINT_RULES).forEach((r) => { rules[r] = 'error'; });

    const linter = new LinterClass({ configType: 'flat' });
    const messages: any[] = linter.verify(code, {
      languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        parserOptions: { ecmaFeatures: { jsx: true } },
        globals,
      },
      rules,
    });

    const out: Issue[] = [];
    for (const m of messages) {
      const meta = m.ruleId ? ESLINT_RULES[m.ruleId] : undefined;
      if (!meta) continue; // parse errors are already shown by the editor
      out.push({
        source: 'static', tool: 'eslint', status: 'verified',
        line: m.line || 1, severity: meta.severity, category: meta.category,
        message: String(m.message), suggestion: meta.suggestion,
      });
      if (out.length >= 15) break;
    }
    return { issues: out };
  } catch (err: any) {
    return { issues: [], note: `ESLint could not check this file: ${err.message}` };
  }
}

async function runTools(code: string, lang: string, filePath?: string): Promise<{ issues: Issue[]; notes: string[] }> {
  const issues: Issue[] = [];
  const notes: string[] = [];
  try {
    if (lang === 'javascript') {
      const r = runEslint(code);
      issues.push(...r.issues);
      if (r.note) notes.push(r.note);
    } else if (lang === 'typescript') {
      notes.push('ESLint runs on JavaScript files. TypeScript files use the built-in rules only.');
    } else if (lang === 'python') {
      const r = await checkPython(code);
      if (!r.available) {
        notes.push(r.reason || 'The Python checker is not available.');
      } else {
        for (const d of r.diagnostics) {
          const isError = d.severity === 'error';
          issues.push({
            source: 'static', tool: 'python', status: 'verified',
            line: d.line, severity: isError ? 'error' : 'info', category: isError ? 'bug' : 'smell',
            message: d.message, suggestion: isError ? 'Fix this before running the program.' : 'Remove it, or use it.',
          });
        }
      }
    } else if (lang === 'java') {
      const r = await checkJava(code, filePath);
      if (!r.available) {
        notes.push(r.reason || 'javac is not available.');
      } else {
        for (const d of r.diagnostics) {
          const isError = d.severity === 'error';
          issues.push({
            source: 'static', tool: 'javac', status: 'verified',
            line: d.line, severity: isError ? 'error' : 'warning', category: isError ? 'bug' : 'smell',
            message: d.message, suggestion: isError ? 'The compiler cannot build this line.' : undefined,
          });
        }
      }
    }
  } catch (err: any) {
    notes.push(`A tool check failed: ${err.message}`);
  }
  return { issues, notes };
}

// ---------- AI review, with validation against the static results ----------
const AI_SYSTEM = `You are a strict but fair code reviewer inside an IDE, helping a student. Review the code and reply with ONLY a JSON object, no markdown and no text around it, in exactly this shape:
{"summary":"one or two sentences","issues":[{"line":12,"severity":"error","category":"bug","message":"what is wrong","suggestion":"how to fix it"}]}
severity is error, warning or info.
category is one of: bug (wrong behaviour, crashes, missing error handling or input validation), security (injection, secrets, unsafe data handling), performance (slow or wasteful code), smell (hard to maintain), style (naming, formatting).
Report only real problems that are visible in the code, at most 8, most important first. "line" is the 1-based line number shown at the start of each code line. Never invent problems. If the code is fine, return an empty issues array.`;

const AI_SECURITY_EXTRA = '\nFocus ONLY on security problems: injection, XSS, hardcoded secrets, unsafe deserialization, weak crypto, missing input validation, unsafe file or command access. Use category "security" for every issue.';

function numbered(code: string): string {
  const rows = code.replace(/\r\n/g, '\n').split('\n');
  let out = '';
  for (let i = 0; i < rows.length; i++) {
    const row = `${i + 1}: ${rows[i]}\n`;
    if (out.length + row.length > MAX_AI_CHARS) { out += '... [rest of the file not shown]\n'; break; }
    out += row;
  }
  return out;
}

function parseAiJson(text: string): { summary: string; issues: any[] } | null {
  const cleaned = text.replace(/```json|```/gi, '');
  const s = cleaned.indexOf('{');
  const e = cleaned.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try {
    const o = JSON.parse(cleaned.slice(s, e + 1));
    return { summary: String(o.summary || ''), issues: Array.isArray(o.issues) ? o.issues : [] };
  } catch {
    return null;
  }
}

function normalizeCategory(raw: any): Category {
  const c = String(raw || '').toLowerCase();
  if (c.includes('secur') || c.includes('vuln')) return 'security';
  if (c.includes('perf')) return 'performance';
  if (c.includes('bug') || c.includes('error') || c.includes('logic') || c.includes('valid')) return 'bug';
  if (c.includes('style') || c.includes('format') || c.includes('naming') || c.includes('read')) return 'style';
  return 'smell';
}

function friendlyAiError(err: any): string {
  const m = String((err && err.message) || err);
  if (/timed out|timeout|abort/i.test(m)) return 'The AI took too long to answer (timeout).';
  if (/429|quota|rate limit|resource.?exhausted/i.test(m)) return 'The AI service reached its usage limit. Wait a few minutes or pick another model.';
  if (/ECONNREFUSED|fetch failed|ENOTFOUND|EAI_AGAIN|Ollama/i.test(m)) return 'Could not reach the AI service. Is Ollama running, and is the internet connected for cloud models?';
  if (/API key|not set|401|403|unauthor/i.test(m)) return 'The AI service rejected the request. Check the API key in backend/.env.';
  if (/invalid format|readable review/i.test(m)) return 'The AI answered in a format that could not be read, even after one retry. Try again or pick a stronger model.';
  return 'The AI review failed: ' + m;
}

async function aiReview(
  provider: string, model: string, code: string, language: string, fileName: string,
  known: Issue[], focusSecurity: boolean
): Promise<{ summary: string; issues: Issue[] }> {
  const lineCount = code.split('\n').length;
  const knownText = known.slice(0, 15).map(i => `line ${i.line}: ${i.message}`).join('\n');
  const base: Msg[] = [
    { role: 'system', content: AI_SYSTEM + (focusSecurity ? AI_SECURITY_EXTRA : '') },
    {
      role: 'user',
      content: `File: ${fileName || 'unknown'} (${language})\n\nAlready found by static analysis and tools (do not repeat these):\n${knownText || '(none)'}\n\nCode:\n${numbered(code)}`,
    },
  ];

  // a reply that is not valid JSON gets one retry
  let parsed: { summary: string; issues: any[] } | null = null;
  let lastReply = '';
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    const messages: Msg[] = attempt === 0
      ? base
      : [
          ...base,
          { role: 'assistant', content: lastReply.slice(0, 2000) },
          { role: 'user', content: 'That was not valid JSON. Reply again with ONLY the JSON object in the exact shape described.' },
        ];
    lastReply = await withTimeout(chat({ provider: provider as any, model, messages }), AI_TIMEOUT_MS);
    parsed = parseAiJson(lastReply);
  }
  if (!parsed) throw new Error('invalid format');

  const issues: Issue[] = [];
  for (const raw of parsed.issues.slice(0, 8)) {
    const line = Number(raw && raw.line);
    const message = String((raw && raw.message) || '').trim();
    if (!Number.isInteger(line) || line < 1 || line > lineCount || !message) continue;
    const sev = String(raw.severity || 'info').toLowerCase();
    issues.push({
      source: 'ai',
      line,
      severity: sev === 'error' ? 'error' : sev === 'warning' ? 'warning' : 'info',
      category: focusSecurity ? 'security' : normalizeCategory(raw.category),
      message,
      suggestion: raw.suggestion ? String(raw.suggestion) : undefined,
    });
  }
  return { summary: parsed.summary, issues };
}

// Every AI finding is checked against the rule and tool findings:
//  - points at a blank or comment line      -> dropped
//  - same line (+-1) and category as a tool -> merged into that finding (marked "AI agrees")
//  - near any tool finding                  -> kept, marked "confirmed"
//  - nothing backs it up                    -> kept, marked "unverified" (AI only)
function crossCheck(staticIssues: Issue[], aiIssues: Issue[], kind: Kind[]) {
  const kept: Issue[] = [];
  let dropped = 0;
  let merged = 0;
  let confirmed = 0;
  let unverified = 0;
  for (const ai of aiIssues) {
    if (kind[ai.line - 1] !== 'code') { dropped++; continue; }
    const same = staticIssues.find((s) => Math.abs(s.line - ai.line) <= 1 && s.category === ai.category);
    if (same) { same.confirmedByAi = true; merged++; continue; }
    const near = staticIssues.some((s) => Math.abs(s.line - ai.line) <= 1);
    ai.status = near ? 'confirmed' : 'unverified';
    if (near) confirmed++; else unverified++;
    kept.push(ai);
  }
  return { kept, stats: { found: aiIssues.length, merged, confirmed, unverified, dropped } };
}

// ---------- npm audit (dependency vulnerabilities) ----------
type AuditFolder = {
  folder: string;
  counts: Record<string, number>;
  top: { name: string; severity: string; fixAvailable: boolean }[];
  error?: string;
};

function findPackageDirs(root: string, depth = 0): string[] {
  if (depth > 2) return [];
  let found: string[] = [];
  try {
    if (fs.existsSync(path.join(root, 'package.json'))) found.push(root);
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.')) {
        found = found.concat(findPackageDirs(path.join(root, e.name), depth + 1));
      }
    }
  } catch {
    // unreadable folder: skip it
  }
  return found;
}

function runAuditIn(dir: string): Promise<{ counts: Record<string, number>; top: AuditFolder['top']; error?: string }> {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const child = spawn('npm audit --json', [], { cwd: dir, shell: true });
    const timer = setTimeout(() => { child.kill(); }, 40000);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      if (!done) { done = true; resolve({ counts: {}, top: [], error: err.message }); }
    });
    child.on('close', () => {
      clearTimeout(timer);
      if (done) return;
      done = true;
      try {
        const j = JSON.parse(out);
        if (j.error) {
          const code = String(j.error.code || '');
          const msg = /ENOLOCK/.test(code) ? 'No package-lock.json: run npm install first.'
            : /ENOTFOUND|EAI_AGAIN|ECONNREFUSED/.test(code) ? 'No internet connection, so the vulnerability database could not be reached.'
            : String(j.error.summary || j.error.code || 'npm audit failed');
          return resolve({ counts: {}, top: [], error: msg });
        }
        const meta = (j.metadata && j.metadata.vulnerabilities) || {};
        const counts: Record<string, number> = {
          critical: meta.critical || 0, high: meta.high || 0, moderate: meta.moderate || 0,
          low: meta.low || 0, total: meta.total || 0,
        };
        const rank: Record<string, number> = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };
        const top = Object.values(j.vulnerabilities || {})
          .map((v: any) => ({ name: String(v.name), severity: String(v.severity), fixAvailable: !!v.fixAvailable }))
          .sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9))
          .slice(0, 8);
        resolve({ counts, top });
      } catch {
        resolve({ counts: {}, top: [], error: 'npm audit gave no readable result.' });
      }
    });
  });
}

async function npmAudit(root: string): Promise<AuditFolder[]> {
  const base = path.resolve(root);
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) return [];
  const dirs = findPackageDirs(base).slice(0, 4);
  const out: AuditFolder[] = [];
  for (const dir of dirs) {
    const r = await runAuditIn(dir);
    out.push({ folder: path.relative(base, dir) || '.', ...r });
  }
  return out;
}

// ---------- routes ----------

// POST /api/ai/analyze-quality
// body: { provider, model, code, language, fileName, filePath, useAi }
router.post('/analyze-quality', async (req, res) => {
  const { provider, model, code, language, fileName, filePath, useAi } = req.body || {};
  if (typeof code !== 'string' || !language) {
    return res.status(400).json({ error: 'code and language are required' });
  }
  if (!SUPPORTED.includes(language)) {
    return res.status(400).json({ error: 'Quality analysis supports Python, Java, JavaScript and TypeScript files.' });
  }
  if (!code.trim()) return res.status(400).json({ error: 'The file is empty.' });
  if (code.length > 300000) return res.status(400).json({ error: 'The file is too large to analyze.' });

  try {
    const t0 = Date.now();
    const result = analyze(code, language);
    const t1 = Date.now();
    const tools = await runTools(code, language, filePath);
    const t2 = Date.now();

    const staticAll: Issue[] = [...result.issues, ...tools.issues];

    // AI review: if it fails for any reason, the static results are still shown (fallback)
    let aiStatus: 'ok' | 'skipped' | 'failed' = 'skipped';
    let aiError = '';
    let aiSummary = '';
    let aiKept: Issue[] = [];
    let validation = { found: 0, merged: 0, confirmed: 0, unverified: 0, dropped: 0 };
    if (useAi !== false) {
      if (!provider || !model) {
        aiError = 'No AI model is selected, so only the static checks ran.';
      } else {
        try {
          const ai = await aiReview(provider, model, code, language, fileName, staticAll, false);
          const checked = crossCheck(staticAll, ai.issues, result.kind);
          aiKept = checked.kept;
          validation = checked.stats;
          aiSummary = ai.summary;
          aiStatus = 'ok';
        } catch (err: any) {
          aiStatus = 'failed';
          aiError = friendlyAiError(err);
        }
      }
    }
    const t3 = Date.now();

    const { score, grade } = computeScore(staticAll, result.metrics.duplication, result.metrics.avgComplexity);
    const all = [...staticAll, ...aiKept].sort(
      (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.line - b.line
    );
    const categoryCounts: Record<string, number> = {};
    CATEGORIES.forEach((c) => { categoryCounts[c] = all.filter((i) => i.category === c).length; });

    const timings = {
      staticMs: t1 - t0,
      toolsMs: t2 - t1,
      aiMs: useAi !== false && provider && model ? t3 - t2 : 0,
      totalMs: t3 - t0,
    };

    let savedId: number | null = null;
    try {
      const info = db.prepare(
        `INSERT INTO quality_runs
          (file_path, file_name, language, score, lines, functions, avg_complexity, max_complexity, duplication,
           issue_count, security_count, ai_status, static_ms, ai_ms, total_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        filePath ?? null, fileName ?? null, language, score, result.metrics.lines,
        result.metrics.functions, result.metrics.avgComplexity, result.metrics.maxComplexity,
        result.metrics.duplication, staticAll.length, categoryCounts.security, aiStatus,
        timings.staticMs + timings.toolsMs, timings.aiMs, timings.totalMs
      );
      savedId = Number(info.lastInsertRowid);
    } catch {
      // saving history must never break the analysis
    }

    res.json({
      score,
      grade,
      metrics: result.metrics,
      topFunctions: result.topFunctions,
      issues: all,
      categoryCounts,
      summary: aiSummary,
      aiStatus,
      aiError,
      validation,
      notes: tools.notes,
      timings,
      savedId,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/security-check
// body: { code?, language?, fileName?, provider?, model?, useAi?, projectRoot? }
// code  -> security findings of one file (rules + optional AI review checked against the rules)
// projectRoot -> npm audit of the dependencies
router.post('/security-check', async (req, res) => {
  const { code, language, fileName, provider, model, useAi, projectRoot } = req.body || {};
  const response: any = { issues: [], audit: null, aiStatus: 'skipped', aiError: '', notes: [] };

  try {
    if (typeof code === 'string' && code.trim() && SUPPORTED.includes(language)) {
      const result = analyze(code, language);
      const tools = await runTools(code, language);
      const staticAll = [...result.issues, ...tools.issues];
      response.notes = tools.notes;
      const secure = staticAll.filter((i) => i.category === 'security');

      let aiKept: Issue[] = [];
      if (useAi !== false && provider && model) {
        try {
          const ai = await aiReview(provider, model, code, language, fileName, staticAll, true);
          aiKept = crossCheck(secure, ai.issues, result.kind).kept;
          response.aiStatus = 'ok';
        } catch (err: any) {
          response.aiStatus = 'failed';
          response.aiError = friendlyAiError(err);
        }
      }
      response.issues = [...secure, ...aiKept].sort(
        (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.line - b.line
      );
    }

    if (projectRoot) response.audit = await npmAudit(String(projectRoot));
    res.json(response);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai/quality-history?filePath=...&limit=30   (used by the Week 10 dashboard)
router.get('/quality-history', (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 200);
    const filePath = req.query.filePath ? String(req.query.filePath) : null;
    const rows = filePath
      ? db.prepare('SELECT * FROM quality_runs WHERE file_path = ? ORDER BY id DESC LIMIT ?').all(filePath, limit)
      : db.prepare('SELECT * FROM quality_runs ORDER BY id DESC LIMIT ?').all(limit);
    res.json({ runs: (rows as any[]).reverse() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;