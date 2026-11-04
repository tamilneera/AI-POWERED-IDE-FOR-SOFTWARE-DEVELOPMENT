// Safe, automatic refactors for the Code Quality panel.
// It only reads and rewrites text, so it needs no backend. Risky changes are never made automatically.

const isJsLang = (l) => l === 'javascript' || l === 'typescript';

// removes string contents and line comments so only the code part is inspected
function codeOnly(line, lang) {
  let s = line.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, '""');
  s = lang === 'python' ? s.replace(/#.*$/, '') : s.replace(/\/\/.*$/, '');
  return s;
}

function isCommentLine(raw, lang) {
  const t = raw.trim();
  if (lang === 'python') return t.startsWith('#');
  return t.startsWith('//') || t.startsWith('/*') || t.startsWith('*');
}

const indentOf = (line) => line.match(/^\s*/)[0];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function hasTopLevelComma(s) {
  let depth = 0;
  for (const ch of s) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) return true;
  }
  return false;
}

// brace depth at the start of every line
function braceDepths(lines, lang) {
  const depthAt = new Array(lines.length + 1).fill(0);
  let d = 0;
  for (let i = 0; i < lines.length; i++) {
    depthAt[i] = d;
    if (isCommentLine(lines[i], lang)) continue;
    for (const ch of codeOnly(lines[i], lang)) {
      if (ch === '{') d++;
      else if (ch === '}') d--;
    }
  }
  depthAt[lines.length] = d;
  return depthAt;
}

// true when the text is exactly one call like console.log(a, b); (the first "(" closes at the very end)
function isSingleCall(s) {
  const t = s.trim().replace(/;$/, '');
  const open = t.indexOf('(');
  if (open < 0 || !t.endsWith(')')) return false;
  let depth = 0;
  for (let k = open; k < t.length; k++) {
    if (t[k] === '(') depth++;
    else if (t[k] === ')') {
      depth--;
      if (depth === 0 && k !== t.length - 1) return false;
    }
  }
  return depth === 0;
}

function prevCodeIndex(lines, i, lang) {
  let j = i - 1;
  while (j >= 0 && (!lines[j].trim() || isCommentLine(lines[j], lang))) j--;
  return j;
}

function nextCodeIndex(lines, i, lang) {
  let j = i + 1;
  while (j < lines.length && (!lines[j].trim() || isCommentLine(lines[j], lang))) j++;
  return j < lines.length ? j : -1;
}

// a statement may only be deleted when removing it cannot change what the lines around it mean
function safeToDelete(lines, i, lang) {
  const p = prevCodeIndex(lines, i, lang);
  if (p >= 0) {
    const last = codeOnly(lines[p], lang).trim().slice(-1);
    if (last) {
      // python: not the first line of a block and not a continuation; js/java: after a finished statement or block
      const ok = lang === 'python' ? !':\\,([{'.includes(last) : '{};'.includes(last);
      if (!ok) return false;
    }
  }
  if (lang !== 'python') {
    const n = nextCodeIndex(lines, i, lang);
    if (n >= 0) {
      const first = lines[n].trim()[0];
      if (first && ')],.(['.includes(first)) return false;
    }
  }
  return true;
}

const LABELS = {
  var: 'var → const / let',
  debug: 'remove leftover debug output',
  catch: 'log errors in empty catch blocks',
  except: 'bare except → except Exception',
};

// returns { edits, count, groups, byLine, skipped }
//  edits:   [{ line, type: 'replace', text } | { line, type: 'delete' }]   (line numbers start at 1)
//  byLine:  { [line]: { [kind]: true } }  which fixes exist on which line
//  skipped: [{ line, reason }]            things left alone on purpose
export function planFixes(code, language) {
  const none = { edits: [], count: 0, groups: [], byLine: {}, skipped: [] };
  if (typeof code !== 'string' || !code.trim()) return none;
  const isJs = isJsLang(language);
  const isPy = language === 'python';
  const isJava = language === 'java';
  if (!isJs && !isPy && !isJava) return none;

  const lines = code.replace(/\r\n/g, '\n').split('\n');
  const edits = [];
  const counts = {};
  const byLine = {};
  const skipped = [];
  const used = new Set();

  const addEdit = (kind, line, edit) => {
    if (used.has(line)) return;
    used.add(line);
    edits.push({ line, ...edit });
    counts[kind] = (counts[kind] || 0) + 1;
    (byLine[line] = byLine[line] || {})[kind] = true;
  };

  // ----- var -> const / let (JavaScript and TypeScript) -----
  if (isJs) {
    const isModule = lines.some((l) => /^\s*(import\s|export\s)|\brequire\(|module\.exports/.test(l));
    const depthAt = braceDepths(lines, language);
    const clean = lines.map((l) => (isCommentLine(l, language) ? '' : codeOnly(l, language)));

    const declCount = {};
    clean.forEach((s) => {
      const re = /\bvar\s+([A-Za-z_$][\w$]*)/g;
      let m;
      while ((m = re.exec(s)) !== null) declCount[m[1]] = (declCount[m[1]] || 0) + 1;
    });

    for (let i = 0; i < lines.length; i++) {
      const m = clean[i].match(/^\s*var\s+([A-Za-z_$][\w$]*)\b/);
      if (!m) continue;
      const name = m[1];
      const line = i + 1;

      if (declCount[name] > 1 || hasTopLevelComma(clean[i])) {
        skipped.push({ line, reason: 'the variable is declared more than once, or several in one list' });
        continue;
      }
      if (depthAt[i] === 0 && !isModule) {
        skipped.push({ line, reason: 'a top-level var in a script can be used by other files' });
        continue;
      }

      const nameRe = new RegExp('(^|[^\\w$.])' + escapeRe(name) + '(?![\\w$])');
      let blockEnd = lines.length - 1;
      for (let k = i; k < lines.length; k++) {
        if (depthAt[k + 1] < depthAt[i]) { blockEnd = k; break; }
      }
      const usedBefore = clean.slice(0, i).some((s) => nameRe.test(s));
      const usedAfter = clean.slice(blockEnd + 1).some((s) => nameRe.test(s));
      if (usedBefore || usedAfter) {
        skipped.push({ line, reason: 'the variable is used outside the block where it is declared' });
        continue;
      }

      const assign = new RegExp('(^|[^\\w$.])' + escapeRe(name) + '\\s*(?:[-+*/%&|^]|\\*\\*|<<|>>>?|&&|\\|\\||\\?\\?)?=(?![=>])');
      const bump = new RegExp('(\\+\\+|--)\\s*' + escapeRe(name) + '(?![\\w$])|(^|[^\\w$.])' + escapeRe(name) + '\\s*(\\+\\+|--)');
      const loopVar = new RegExp('for\\s*\\(\\s*(?:const|let|var)?\\s*' + escapeRe(name) + '\\s+(?:of|in)\\b');
      const reassigned = clean.some((s, k) => k !== i && (assign.test(s) || bump.test(s) || loopVar.test(s)));
      const hasInit = /^\s*var\s+[\w$]+\s*(?::[^=;]*)?=(?![=>])/.test(clean[i]);
      const keyword = hasInit && !reassigned ? 'const' : 'let';

      addEdit('var', line, { type: 'replace', text: lines[i].replace(/^(\s*)var\b/, '$1' + keyword) });
    }
  }

  // ----- leftover debug output -----
  const debugRe = isJs ? /^\s*console\.(?:log|debug)\(/ : isJava ? /^\s*System\.out\.print(?:ln|f)?\(/ : /^\s*print\(/;
  for (let i = 0; i < lines.length; i++) {
    if (isCommentLine(lines[i], language)) continue;
    const s = codeOnly(lines[i], language);
    if (!debugRe.test(s) || !isSingleCall(s)) continue;
    if (!safeToDelete(lines, i, language)) continue;
    addEdit('debug', i + 1, { type: 'delete' });
  }

  // ----- empty catch blocks (JavaScript and TypeScript) -----
  if (isJs) {
    for (let i = 0; i < lines.length; i++) {
      if (isCommentLine(lines[i], language)) continue;
      const s = codeOnly(lines[i], language);
      if (/catch\s*(?:\(\s*[\w$]+[^)]*\))?\s*\{\s*\}/.test(s)) {
        const text = lines[i].replace(
          /catch\s*(?:\(\s*([\w$]+)([^)]*)\))?\s*\{\s*\}/,
          (m, name, rest) => (name ? `catch (${name}${rest}) { console.error(${name}); }` : 'catch (error) { console.error(error); }')
        );
        if (text !== lines[i]) addEdit('catch', i + 1, { type: 'replace', text });
      } else if (/catch\s*(?:\(\s*[\w$]+[^)]*\))?\s*\{\s*$/.test(s) && i + 1 < lines.length && lines[i + 1].trim() === '}') {
        const m = s.match(/catch\s*(?:\(\s*([\w$]+)[^)]*\))?\s*\{\s*$/);
        const name = m && m[1] ? m[1] : 'error';
        const head = m && m[1] ? lines[i] : lines[i].replace(/catch\s*\{\s*$/, 'catch (error) {');
        addEdit('catch', i + 1, {
          type: 'replace',
          text: head + '\n' + indentOf(lines[i + 1]) + '  console.error(' + name + ');',
        });
      }
    }
  }

  // ----- bare except (Python) -----
  if (isPy) {
    for (let i = 0; i < lines.length; i++) {
      if (isCommentLine(lines[i], language)) continue;
      if (/^\s*except\s*:/.test(codeOnly(lines[i], language))) {
        addEdit('except', i + 1, { type: 'replace', text: lines[i].replace(/^(\s*)except\s*:/, '$1except Exception:') });
      }
    }
  }

  edits.sort((a, b) => a.line - b.line);
  const groups = Object.keys(counts).map((k) => ({ kind: k, label: LABELS[k], count: counts[k] }));
  return { edits, count: edits.length, groups, byLine, skipped };
}

// which automatic fix (if any) belongs to a panel issue
export function fixKindOfIssue(issue) {
  if (!issue || issue.source === 'ai') return null;
  const m = issue.message || '';
  if (/^var is function-scoped/i.test(m)) return 'var';
  if (/^Leftover debug output/i.test(m)) return 'debug';
  if (/^Empty catch block/i.test(m)) return 'catch';
  if (/^Bare except/i.test(m)) return 'except';
  return null;
}