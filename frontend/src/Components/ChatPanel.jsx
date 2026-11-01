import { useState, useRef, useEffect } from 'react';
import { BACKEND_URL } from '../config';
import ModelSelector from './ModelSelector';
import { C } from '../theme';

const MAX_FILE_CHARS = 4000; // keeps local models from choking on huge files

// The AI always behaves like a coding partner: explain code, find and fix errors, answer questions.
const SYSTEM_PROMPT = `You are a friendly, accurate coding assistant inside an IDE, helping a student. Only state facts you are sure about; if you are not sure, say so. Never invent facts.

IMPORTANT: follow-up requests ("give me practice questions", "make it shorter", "explain more", "now do X") are about the PREVIOUS messages in this chat. An open file or error list below is only background: use it only when the user asks about their code, errors or file, or says "this code" / "my file". Otherwise ignore it.

WHEN THE USER ASKS ABOUT CODE (pasted, selected, or an open file), first check it line by line for real errors (missing colon, bracket, quote, value, typos, bugs). Use only facts from the code; do not mention keywords or languages that are not in it. Then answer in ONE of two ways:
A) NO errors: write "No problems found." then explain what the code does, step by step, in simple words. Do NOT show fixed code.
B) Errors found: list each error with its line, then give exactly ONE code block with the corrected code (it must differ from the original; if a value is missing add a placeholder such as 0), then one line saying what changed. If the user selected code, fix only the selection; otherwise give the full file. Keep this under 150 words.

WHEN THE USER ASKS A QUESTION (concepts, differences, how-to, write code, practice questions): answer clearly like a good teacher.
- Start with a one-line direct answer.
- For "difference" or "compare" questions, use a small markdown table (| Feature | A | B |), then a short code example.
- For "explain" questions, use short bullet points, then a small example.
- For "write code" requests, give ONE complete working code block, then one or two lines on how it works.
- Add a short closing tip only if it genuinely helps; skip it otherwise.
Use **bold** for key terms and \`backticks\` for code words. Be correct before being long: stay under 250 words.`;
const ASSISTANT_NAME = 'AI Assistant'; // change this one line to rename the panel

const SCOPES = [
  { id: 'none', label: 'No file' },
  { id: 'active', label: 'Active file' },
  { id: 'open', label: 'Open files' },
];


const pillStyle = {
  display: 'flex', alignItems: 'center', gap: '4px',
  background: C.card, color: '#c9cde0', border: `1px solid ${C.border}`,
  borderRadius: '14px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer',
  userSelect: 'none', whiteSpace: 'nowrap',
};

const menuStyle = {
  background: '#1b1e2a', border: `1px solid ${C.border}`, borderRadius: '8px',
  minWidth: '190px', maxHeight: '240px', overflowY: 'auto',
  boxShadow: '0 6px 18px rgba(0,0,0,0.55)',
};

const menuItemStyle = {
  display: 'flex', alignItems: 'center', gap: '8px',
  padding: '8px 12px', fontSize: '12px', cursor: 'pointer', color: '#d5d8e8',
};

const actionLinkStyle = {
  color: C.muted, fontSize: '11px', cursor: 'pointer', marginTop: '4px', userSelect: 'none',
};

function hover(e, on) {
  e.currentTarget.style.background = on ? '#262b3b' : 'transparent';
}

function PillMenu({ value, options, onChange, title }) {
  const [open, setOpen] = useState(false);
  const current = options.find(o => o.id === value);
  return (
    <div style={{ position: 'relative' }}>
      <span onClick={() => setOpen(o => !o)} title={title} style={pillStyle}>
        {current?.label} ▾
      </span>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
          <div style={{ position: 'absolute', bottom: '30px', left: 0, zIndex: 100, ...menuStyle }}>
            {options.map(o => (
              <div
                key={o.id}
                onClick={() => { onChange(o.id); setOpen(false); }}
                onMouseEnter={(e) => hover(e, true)}
                onMouseLeave={(e) => hover(e, false)}
                style={{ ...menuItemStyle, color: o.id === value ? '#a99dff' : '#d5d8e8' }}
              >
                <span style={{ width: '12px' }}>{o.id === value ? '✓' : ''}</span>
                {o.label}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Turns **bold** and `code` inside one line of text into styled pieces
function renderInline(text) {
  const out = [];
  const re = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;
  let last = 0, m, k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) {
      out.push(<b key={k++} style={{ color: '#fff' }}>{t.slice(2, -2)}</b>);
    } else {
      out.push(
        <code key={k++} style={{
          background: '#0d0f16', border: `1px solid ${C.border}`, borderRadius: '4px',
          padding: '0 4px', fontSize: '12px', fontFamily: 'Consolas, monospace', color: '#d6dcff',
        }}>{t.slice(1, -1)}</code>
      );
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Markdown table lines ("| a | b |") -> a real table
function renderTable(lines, key) {
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  const rows = lines.map(cells).filter(r => !r.every(c => /^:?-{2,}:?$/.test(c)));
  if (rows.length === 0) return null;
  const [head, ...body] = rows;
  const cell = { border: `1px solid ${C.border}`, padding: '4px 8px', textAlign: 'left', verticalAlign: 'top' };
  return (
    <div key={key} style={{ overflowX: 'auto', margin: '6px 0' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: '12px', width: '100%' }}>
        <thead>
          <tr>{head.map((h, i) => <th key={i} style={{ ...cell, background: C.card, color: '#fff' }}>{renderInline(h)}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri}>{r.map((c, ci) => <td key={ci} style={cell}>{renderInline(c)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Plain AI text -> headings, bullet / numbered lists, tables and paragraphs
function renderText(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') { out.push(<div key={i} style={{ height: '6px' }} />); continue; }
    if (line.trim().startsWith('|')) {
      const group = [];
      let j = i;
      while (j < lines.length && lines[j].trim().startsWith('|')) { group.push(lines[j]); j++; }
      const table = renderTable(group, i);
      if (table) out.push(table);
      i = j - 1;
      continue;
    }
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) { out.push(<div key={i} style={{ fontWeight: 700, color: '#fff', margin: '6px 0 2px' }}>{renderInline(h[1])}</div>); continue; }
    const li = line.match(/^\s*([-*•]|\d+[.)])\s+(.*)$/);
    if (li) {
      const marker = /\d/.test(li[1]) ? li[1] : '•';
      out.push(
        <div key={i} style={{ display: 'flex', gap: '8px', margin: '2px 0', paddingLeft: '4px' }}>
          <span style={{ color: '#a99dff', minWidth: '16px' }}>{marker}</span>
          <span style={{ flex: 1 }}>{renderInline(li[2])}</span>
        </div>
      );
      continue;
    }
    out.push(<div key={i} style={{ margin: '1px 0' }}>{renderInline(line)}</div>);
  }
  return out;
}

// Renders ```code``` blocks nicely; formatted=true also formats the normal text (AI answers)
function renderContent(text, onApply, formatted) {
  let blockNo = -1;
  return text.split('```').map((part, i) => {
    if (i % 2 === 1) {
      blockNo += 1;
      const nl = part.indexOf('\n');
      const code = (nl >= 0 ? part.slice(nl + 1) : part).replace(/\n+$/, '');
      return (
        <div key={i} style={{ margin: '6px 0' }}>
          {onApply && (
            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', marginBottom: '3px' }}>
              <span
                onClick={() => { try { navigator.clipboard.writeText(code); } catch { /* ignore */ } }}
                style={{ ...pillStyle, padding: '2px 8px', fontSize: '10px' }}
              >Copy</span>
              <span
                onClick={() => onApply(code)}
                style={{ ...pillStyle, padding: '2px 8px', fontSize: '10px', color: '#fff', background: C.accent, borderColor: C.accent }}
              >Apply to editor</span>
            </div>
          )}
          <pre style={{
            background: '#0d0f16', border: `1px solid ${C.border}`, borderRadius: '6px',
            padding: '8px 10px', margin: 0, overflowX: 'auto',
            fontSize: '12px', fontFamily: 'Consolas, monospace', color: '#d6dcff', whiteSpace: 'pre',
          }}>
            <code>{code}</code>
          </pre>
        </div>
      );
    }
    return formatted ? <div key={i}>{renderText(part)}</div> : <span key={i}>{part}</span>;
  });
}

const getFileName = (path) => path.split(/[\\/]/).pop();

// code blocks inside an AI reply -> plain code strings
function extractCodeBlocks(text) {
  return text.split('```').filter((_, i) => i % 2 === 1).map(part => {
    const nl = part.indexOf('\n');
    return (nl >= 0 ? part.slice(nl + 1) : part).replace(/\n+$/, '');
  });
}

const FIX_INTENT = /\b(fix|correct|repair|solve|resolve|debug|rewrite)\b/i;
const lineCount = (t) => (t || '').split('\n').length;

// ---------- "create a whole project" mode ----------
// When a folder is open and the user asks to create/build a project or app, the AI answers with every file,
// and the chat shows a preview card with a Create button that writes the files into the open folder.
// After that, "Run & fix" installs the packages, starts the app and lets the AI repair any errors.
const PROJECT_INTENT = /\b(create|build|make|generate|scaffold|set\s*up|start)\b[\s\S]{0,60}\b(project|app|application|website|web\s*site|full[\s-]?stack|frontend|backend|api|server)\b/i;

const PROJECT_PROMPT = `You are a senior full-stack developer inside an IDE. Create the project the user asks for as a complete, polished, working app (at most 10 files).
Reply in exactly this format:
1. One or two lines saying what you are building.
2. Then EVERY file, each written as a line "FILE: relative/path" followed by a code block with the full content of that file. Example:
FILE: server.js
\`\`\`js
console.log("hi");
\`\`\`
3. Finish with a short "How to run" list.

ARCHITECTURE (always, unless the user asks for something else):
- ONE Node project at the top level: package.json (scripts: "start": "node server.js"), server.js, README.md, and a public/ folder with index.html, styles.css and app.js.
- server.js uses Express only (no other dependencies), serves the public/ folder with express.static, listens on process.env.PORT || 3001 (never 5000 or 3000), and prints "Server running on http://localhost:3001".
- The page is plain HTML, CSS and JavaScript (no React, no build step, no CDN links, no external fonts). It calls the API with relative URLs like fetch("/api/todos").
- Keep data in memory or a JSON file. Use string ids (crypto.randomUUID()).
- Use EXACTLY the same field names in the server and in app.js. For lists use { id, title, completed }. Before finishing, check every field name and URL that app.js uses against server.js.
- Register fixed routes (like DELETE /api/todos/completed) BEFORE parameter routes (like /api/todos/:id). Validate input and return { error: "message" } with a proper status code on bad requests.

DESIGN (this is as important as the code):
- Soft page background (#f7f7fb) with a faint radial purple glow, a centered white card (max width about 674px, radius 17px, soft shadow), system fonts only: "Segoe UI", sans-serif.
- Colors: ink #242337, muted #89899b, accent purple #7866d6 (hover #6653c3), soft purple #f0edff, borders #efeff4. Use CSS variables.
- Top bar with a small logo mark and app name, a friendly heading with the current date, a card title with a count badge, a completion ring (conic-gradient) and a thin progress bar.
- Add-item form with a focus ring, filter buttons (All / To do / Done) with counts, a "Clear completed" button that only shows when needed.
- List rows with custom checkboxes, strike-through for done items, edit and delete icon buttons that appear on hover, inline edit (Enter saves, Escape cancels).
- A friendly empty state, an error message area, subtle 180ms transitions and a fade-in for new rows, visible focus styles, a responsive layout for phones, and prefers-reduced-motion support.
- Escape all user text before putting it into innerHTML.
For apps that are not a list (a calculator, notes, a dashboard), keep the same architecture and the same level of design polish.

RULES: use relative paths only, never absolute paths and never "..". Write complete files, never snippets or "...". Do not output anything outside the format above.`;

const MAX_PROJECT_FILES = 30;
const MAX_PROJECT_FILE_CHARS = 100000;

// keep only safe relative paths: no "..", no drive letters, no absolute paths
function cleanProjectPath(p) {
  const x = p.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!x || x.startsWith('/') || /^[a-zA-Z]:/.test(x)) return null;
  if (x.split('/').some(seg => seg === '' || seg === '.' || seg === '..')) return null;
  if (/[<>:"|?*]/.test(x)) return null;
  return x;
}

// "FILE: path" line + code block  ->  [{ path, content }]
function parseProjectFiles(text) {
  const re = /^[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*)?FILE:[ \t]*`?([^\n`*]+?)`?(?:\*\*)?[ \t]*\n+```[^\n]*\n([\s\S]*?)\n```/gm;
  const byPath = new Map();
  let m;
  while ((m = re.exec(text)) !== null) {
    const rel = cleanProjectPath(m[1]);
    if (rel && m[2].length <= MAX_PROJECT_FILE_CHARS) byPath.set(rel, { path: rel, content: m[2] });
  }
  return [...byPath.values()].slice(0, MAX_PROJECT_FILES);
}

function ChatPanel({ model, onModelChange, onClose, openFiles = [], activeFile = null, getEditorContext, onApplyCode, onUndoCode, workspacePath = '' }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('chat');
  const [scope, setScope] = useState('active');
  const [attachments, setAttachments] = useState([]); // manual: [{ path, name, content, language }]
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editText, setEditText] = useState('');
  const endRef = useRef(null);
  const activeFileRef = useRef(activeFile);
  activeFileRef.current = activeFile; // always the latest open file, even inside async code

  useEffect(() => {
    endRef.current?.scrollIntoView();
  }, [messages, loading, tab]);

  // ---------- attachments ----------
  const addAttachment = (file) => {
    setAttachments(prev => [...prev.filter(a => a.path !== file.path), file]);
  };

  const removeAttachment = (path) => {
    setAttachments(prev => prev.filter(a => a.path !== path));
  };

  const toggleOpenFile = (f) => {
    if (attachments.some(a => a.path === f.path)) removeAttachment(f.path);
    else addAttachment({ path: f.path, name: f.name || getFileName(f.path), content: f.content, language: f.language });
  };

  const attachActive = () => {
    if (!activeFile) return;
    addAttachment({
      path: activeFile.path,
      name: activeFile.name || getFileName(activeFile.path),
      content: activeFile.content,
      language: activeFile.language,
    });
    setShowAttachMenu(false);
  };

  const browseComputer = async () => {
    setShowAttachMenu(false);
    if (!window.electronAPI?.pickAttachmentFile) return;
    const filePath = await window.electronAPI.pickAttachmentFile();
    if (!filePath) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/files/read?path=${encodeURIComponent(filePath)}`);
      const data = await res.json();
      addAttachment({ path: filePath, name: getFileName(filePath), content: data.content || '', language: '' });
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Could not read file: ' + err.message, isError: true }]);
    }
  };

  // everything that will go to the AI with the next message
  const buildContextFiles = () => {
    const map = new Map();
    attachments.forEach(a => map.set(a.path, a));
    if (scope === 'active' && activeFile) {
      map.set(activeFile.path, activeFile);
    }
    if (scope === 'open') {
      openFiles.forEach(f => map.set(f.path, f));
    }
    return [...map.values()];
  };

  // ---------- apply an AI fix to the editor ----------
  // msgIndex: which chat message; code: the corrected code; auto: true when applied without a click;
  // meta: { filePath, selectionRange } remembered when the question was asked
  const applyFix = (msgIndex, code, auto, meta) => {
    const cur = activeFileRef.current;
    let note = null;
    let ok = false;
    if (!meta || !meta.filePath) {
      note = 'No file was attached to that question, so there is nothing to apply it to.';
    } else if (!cur || cur.path !== meta.filePath) {
      note = `Open ${getFileName(meta.filePath)} in the editor first, then press Apply.`;
    } else {
      ok = !!(onApplyCode && onApplyCode({ code, range: meta.selectionRange || null }));
      if (!ok) note = 'Could not reach the editor.';
    }
    setMessages(prev => prev.map((x, i) => i === msgIndex
      ? { ...x, applied: ok, applyNote: ok ? (auto ? 'auto' : 'manual') : note }
      : x));
  };

  const undoFix = (msgIndex) => {
    if (onUndoCode) onUndoCode();
    setMessages(prev => prev.map((x, i) => i === msgIndex ? { ...x, applied: false, applyNote: 'undone' } : x));
  };

  // ---------- create the generated project on disk ----------
  const patchMessage = (index, patch) => {
    setMessages(prev => prev.map((x, i) => i === index ? { ...x, ...patch } : x));
  };

  const addFixLog = (index, line) => {
    setMessages(prev => prev.map((x, i) => i === index ? { ...x, fixLog: [...(x.fixLog || []), line] } : x));
  };

  const createProject = async (index) => {
    const m = messages[index];
    if (!m || !m.projectFiles || m.projectStatus === 'creating') return;
    const root = (m.workspacePath || '').replace(/[\\/]+$/, '');
    const name = (m.projectName || '').trim(); // empty = put the files straight into the open folder
    if (!root) { patchMessage(index, { projectNote: 'Open a folder first (File → Open Folder).' }); return; }
    if (name && (!/^[\w.-]+$/.test(name) || name === '.' || name === '..')) {
      patchMessage(index, { projectNote: 'Sub-folder name: use only letters, numbers, - _ and . (or leave it empty).' });
      return;
    }

    patchMessage(index, { projectStatus: 'creating', projectNote: '' });
    const sep = root.includes('\\') ? '\\' : '/';
    const full = (...segs) => [root, ...(name ? [name] : []), ...segs].join(sep);
    const post = (url, body) => fetch(`${BACKEND_URL}${url}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });

    // every folder, shallowest first: project folder, backend, backend/src, ...
    const dirs = new Set(name ? [full()] : []); // the open folder already exists
    m.projectFiles.forEach(f => {
      const parts = f.path.split('/').slice(0, -1);
      for (let i = 1; i <= parts.length; i++) dirs.add(full(...parts.slice(0, i)));
    });

    let mkdirProblem = '';
    try {
      for (const d of [...dirs].sort((a, b) => a.length - b.length)) {
        try {
          const r = await post('/api/files/mkdir', { path: d });
          let data = {};
          try { data = await r.json(); } catch { /* no JSON body */ }
          if (!r.ok || data.success === false || data.error) {
            mkdirProblem = `${d} -> ${data.error || ('HTTP ' + r.status)}`;
            console.warn('[AI chat] could not create folder:', mkdirProblem);
          }
        } catch (e) {
          mkdirProblem = `${d} -> ${e.message}`;
          console.warn('[AI chat] could not create folder:', mkdirProblem);
        }
      }
      let done = 0;
      for (const f of m.projectFiles) {
        const res = await post('/api/files/write', { path: full(...f.path.split('/')), content: f.content });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || `could not write ${f.path}`);
        done += 1;
      }
      patchMessage(index, {
        projectStatus: 'done',
        projectRoot: full(),
        projectNote: `Created ${done} files in ${name ? name + '/' : 'the open folder'}. Check the Explorer (press refresh if it has not updated).`,
      });
    } catch (err) {
      patchMessage(index, { projectStatus: 'ready', projectNote: 'Failed: ' + err.message + (mkdirProblem ? `  |  Folder step said: ${mkdirProblem}` : '') });
    }
  };

  // ---------- Run & fix: npm install, start the app, let the AI repair errors (up to 3 times) ----------
  const runAndFix = async (index) => {
    const m = messages[index];
    if (!m || !m.projectRoot || m.fixStatus === 'running') return;
    if (!model) { patchMessage(index, { fixLog: ['Pick a model first.'], fixStatus: 'failed' }); return; }

    patchMessage(index, { fixStatus: 'running', fixLog: ['Starting...'] });
    let finalType = 'error';
    try {
      const res = await fetch(`${BACKEND_URL}/api/autofix/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: model.provider, model: model.model, root: m.projectRoot, maxFixes: 3 }),
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        addFixLog(index, 'Failed: ' + (d.error || 'request failed'));
      } else {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            if (!line.trim()) continue;
            let ev;
            try { ev = JSON.parse(line); } catch { continue; }
            addFixLog(index, ev.message);
            if (ev.type === 'done' || ev.type === 'error') finalType = ev.type;
          }
        }
      }
    } catch (err) {
      addFixLog(index, 'Failed: ' + err.message);
    }
    patchMessage(index, { fixStatus: finalType === 'done' ? 'ok' : 'failed' });
  };

  // ---------- send / retry / edit ----------
  // Asks the AI for a reply to `history` (the last message in it is the user's question).
  // Everything the editor knew when the question was asked is stored on that user message (m.ctx),
  // so Retry and Edit send exactly the same context again.
  const requestReply = async (history) => {
    const lastUser = [...history].reverse().find(m => m.role === 'user');
    if (!lastUser) return;
    const c = lastUser.ctx || {};
    const selection = c.selection || '';
    const selectionRange = selection ? (c.range || null) : null;
    const fileName = c.fileName || 'unknown';
    const askedFix = FIX_INTENT.test(lastUser.content);
    const builder = !!c.workspacePath && PROJECT_INTENT.test(lastUser.content);
    const msgIndex = history.length; // where the assistant message will land

    setLoading(true);

    // Local Ollama models are small and slow, so send less. Cloud models (Gemini etc.) can take much more.
    const isLocal = String(model.provider || '').toLowerCase() === 'ollama';
    const maxChars = isLocal ? MAX_FILE_CHARS : 30000;
    const maxHistory = isLocal ? 6 : 20;

    const parts = [SYSTEM_PROMPT];
    if (selection) {
      parts.push(`The user has this code SELECTED in the editor (file: ${fileName}):\n\`\`\`\n${selection.slice(0, maxChars)}\n\`\`\``);
    }
    if (c.problems && c.problems.length > 0) {
      const list = c.problems.slice(0, 15)
        .map(p => `- ${p.severity === 8 ? 'ERROR' : 'WARNING'} at line ${p.line}, column ${p.column}: ${p.message}`)
        .join('\n');
      parts.push(`The IDE reports these problems in the active file (${fileName}):\n${list}`);
    }
    (c.fileObjs || []).forEach(f => {
      const content = (f.content || '').length > maxChars
        ? f.content.slice(0, maxChars) + '\n... [file truncated]'
        : (f.content || '');
      parts.push(`File: ${f.path}\n\`\`\`${f.language || ''}\n${content}\n\`\`\``);
    });

    if (builder) { parts.length = 0; parts.push(PROJECT_PROMPT); } // project mode ignores the open file / errors

    // local models get the last 6 messages only (small context window); error bubbles are never sent
    const cleanMessages = history.filter(m => !m.isError).slice(-maxHistory).map(({ role, content }) => ({ role, content }));
    const requestMessages = [{ role: 'system', content: parts.join('\n\n') }, ...cleanMessages];

    const sentChars = JSON.stringify(requestMessages).length;
    const t0 = Date.now();
    console.log(`[AI chat] sending to ${model.provider}:${model.model} - ${sentChars} characters, ${requestMessages.length} messages`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300000);

    try {
      const res = await fetch(`${BACKEND_URL}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: model.provider, model: model.model, messages: requestMessages }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      console.log(`[AI chat] answered in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      if (data.reply) {
        const reply = data.reply;
        const blocks = extractCodeBlocks(reply);
        const fixCode = blocks.length ? blocks[blocks.length - 1] : '';
        const projectFiles = builder ? parseProjectFiles(reply) : [];
        setMessages([...history, {
          role: 'assistant', content: reply,
          filePath: c.filePath || null,
          selectionRange,
          ...(projectFiles.length ? { projectFiles, projectName: '', workspacePath: c.workspacePath, projectStatus: 'ready' } : {}),
          ...(!c.workspacePath && PROJECT_INTENT.test(lastUser.content) ? { noFolderHint: true } : {}),
        }]);

        // "fix this" -> apply automatically, but only when it is clearly safe:
        //  a selection was fixed, or the code block looks like the whole file
        if (askedFix && fixCode && c.filePath && !builder) {
          const fileText = c.fileContent || '';
          const fileLines = lineCount(fileText);
          const looksComplete = selectionRange || fileLines <= 6 || lineCount(fixCode) >= fileLines * 0.6;
          if (looksComplete && fixCode.trim() !== fileText.trim()) {
            setTimeout(() => applyFix(msgIndex, fixCode, true, { filePath: c.filePath, selectionRange }), 0);
          }
        }
      } else {
        setMessages([...history, { role: 'assistant', content: 'Error: ' + (data.error || 'no reply'), isError: true }]);
      }
    } catch (err) {
      clearTimeout(timeout);
      const msg = err.name === 'AbortError'
        ? `No answer after 5 minutes (model: ${model.model}, sent ${sentChars} characters). Run "ollama ps" to check the model is loaded, and try a smaller selection.`
        : err.message;
      console.log(`[AI chat] failed after ${((Date.now() - t0) / 1000).toFixed(1)}s:`, err.name, err.message);
      setMessages([...history, { role: 'assistant', content: 'Error: ' + msg, isError: true }]);
    } finally {
      setLoading(false);
    }
  };

  const send = () => {
    if (!input.trim() || !model || loading) return;

    // what the editor knows right now: selected text + errors/warnings
    let ctx = { selection: '', problems: [] };
    if (scope !== 'none') {
      try { ctx = (getEditorContext && getEditorContext()) || ctx; } catch { /* ignore */ }
    }

    // With a selection, send ONLY the selected code (not the whole file too) - much faster for local models.
    // Files attached with + are always sent.
    const allFiles = buildContextFiles();
    const files = ctx.selection ? allFiles.filter(f => attachments.some(a => a.path === f.path)) : allFiles;
    const names = files.map(f => f.name || getFileName(f.path));
    const cur = activeFileRef.current;
    const curName = cur ? (cur.name || getFileName(cur.path)) : null;
    if (ctx.selection && curName) names.unshift(`selection in ${curName}`);

    const userMsg = {
      role: 'user', content: input, files: names,
      ctx: {
        selection: ctx.selection || '',
        range: ctx.selection ? (ctx.range || null) : null,
        problems: ctx.problems || [],
        fileObjs: files.map(f => ({ path: f.path, name: f.name, content: f.content, language: f.language })),
        filePath: cur ? cur.path : null,
        fileName: curName,
        fileContent: cur ? (cur.content || '') : '',
        workspacePath: workspacePath || '',
      },
    };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput('');
    setAttachments([]);
    requestReply(history);
  };

  // ask the same question again (drops the last answer / error)
  const retry = () => {
    if (loading) return;
    let idx = -1;
    for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].role === 'user') { idx = i; break; } }
    if (idx < 0) return;
    const history = messages.slice(0, idx + 1);
    setMessages(history);
    requestReply(history);
  };

  // edit one of your messages: everything after it is removed and the AI answers again
  const startEdit = (index) => {
    if (loading) return;
    setEditingIndex(index);
    setEditText(messages[index].content);
  };

  const saveEdit = () => {
    if (editingIndex === null || !editText.trim() || loading) return;
    const history = [...messages.slice(0, editingIndex), { ...messages[editingIndex], content: editText }];
    setEditingIndex(null);
    setEditText('');
    setMessages(history);
    requestReply(history);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const contextFiles = buildContextFiles();
  const lastIndex = messages.length - 1;
  const canSend = model && !loading && input.trim();

  const tabs = [
    { id: 'chat', label: 'Chat', icon: '💬', enabled: true },
    { id: 'code', label: 'Code', icon: '</>', enabled: false },
    { id: 'agents', label: 'Agents', icon: '🤖', enabled: false },
    { id: 'context', label: 'Context', icon: '📎', enabled: true },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.bg }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px 8px 14px', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '30px', height: '30px', borderRadius: '8px', background: C.accentSoft,
            color: '#a99dff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px',
          }}>✦</div>
          <div>
            <div style={{ color: C.text, fontSize: '13px', fontWeight: 700, letterSpacing: '0.5px' }}>{ASSISTANT_NAME.toUpperCase()}</div>
            <div style={{ color: C.muted, fontSize: '11px' }}>Your AI coding partner</div>
          </div>
        </div>
        {onClose && (
          <span onClick={onClose} style={{ color: C.muted, cursor: 'pointer', fontSize: '14px' }} title="Close">✕</span>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', padding: '0 10px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        {tabs.map(t => (
          <div
            key={t.id}
            onClick={() => t.enabled && setTab(t.id)}
            title={t.enabled ? '' : 'Coming soon'}
            style={{
              padding: '8px 10px', fontSize: '12px',
              cursor: t.enabled ? 'pointer' : 'not-allowed',
              color: tab === t.id ? '#fff' : (t.enabled ? C.muted : '#4a4f63'),
              borderBottom: tab === t.id ? `2px solid ${C.accent}` : '2px solid transparent',
              background: tab === t.id ? C.accentSoft : 'transparent',
              borderRadius: '6px 6px 0 0',
            }}
          >
            {t.label}
          </div>
        ))}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px', fontSize: '13px' }}>
        {tab === 'chat' && (
          <>
            {messages.length === 0 && (
              <div style={{ color: C.muted, fontSize: '12px', lineHeight: 1.7 }}>
                Paste code or just ask. I'll explain it, find the bugs and show the fix. The file open in the editor,
                your selected text and the editor's errors are included automatically. Use <b style={{ color: '#a99dff' }}>+</b> to
                attach other files.
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{
                marginBottom: '14px', display: 'flex', flexDirection: 'column',
                alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
              }}>
                {m.role === 'user' && editingIndex === i ? (
                  <div style={{ width: '90%' }}>
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={3}
                      autoFocus
                      style={{
                        width: '100%', boxSizing: 'border-box', background: C.panel, color: C.text,
                        border: `1px solid ${C.accent}`, borderRadius: '8px', padding: '8px',
                        fontSize: '13px', fontFamily: 'inherit', resize: 'vertical', outline: 'none',
                      }}
                    />
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '6px' }}>
                      <span onClick={() => setEditingIndex(null)} style={pillStyle}>Cancel</span>
                      <span
                        onClick={saveEdit}
                        style={{ ...pillStyle, color: '#fff', background: C.accent, borderColor: C.accent }}
                      >Send</span>
                    </div>
                  </div>
                ) : (
                  <div style={{
                    maxWidth: '90%',
                    background: m.isError ? '#3a1d24' : (m.role === 'user' ? C.accentSoft : C.panel),
                    border: `1px solid ${m.isError ? '#5a2a35' : (m.role === 'user' ? '#3a3480' : C.border)}`,
                    color: C.text, padding: '9px 12px', borderRadius: '12px',
                    whiteSpace: m.role === 'assistant' && !m.isError ? 'normal' : 'pre-wrap',
                    lineHeight: 1.55, wordBreak: 'break-word',
                  }}>
                    {renderContent(m.content, m.role === 'assistant' && !m.isError && !m.projectFiles
                      ? (code) => applyFix(i, code, false, m) : null,
                      m.role === 'assistant' && !m.isError)}
                  </div>
                )}
                {m.role === 'assistant' && (m.applied || m.applyNote) && (
                  <div style={{ fontSize: '11px', marginTop: '4px', color: m.applied ? '#7ee2a8' : C.muted }}>
                    {m.applied && (
                      <>
                        ✓ {m.applyNote === 'auto' ? 'Fix applied to the editor' : 'Applied to the editor'}. Press Ctrl+S to save.{' '}
                        <span onClick={() => undoFix(i)} style={{ color: '#a99dff', cursor: 'pointer', textDecoration: 'underline' }}>Undo</span>
                      </>
                    )}
                    {!m.applied && m.applyNote === 'undone' && 'Undone.'}
                    {!m.applied && m.applyNote && m.applyNote !== 'undone' && m.applyNote !== 'auto' && m.applyNote !== 'manual' && m.applyNote}
                  </div>
                )}
                {m.files && m.files.length > 0 && (
                  <div style={{ color: C.muted, fontSize: '10px', marginTop: '4px' }}>
                    📎 {m.files.join(', ')}
                  </div>
                )}
                {m.role === 'assistant' && m.noFolderHint && (
                  <div style={{ fontSize: '11px', marginTop: '4px', color: C.muted }}>
                    To let me create these files for you, open a folder first (File → Open Folder), then ask again.
                  </div>
                )}
                {m.role === 'assistant' && m.projectFiles && (
                  <div style={{
                    maxWidth: '90%', width: '90%', marginTop: '8px', background: C.card,
                    border: `1px solid ${C.border}`, borderRadius: '10px', padding: '10px', boxSizing: 'border-box',
                  }}>
                    <div style={{ color: '#fff', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                      📁 {m.projectFiles.length} files ready to create
                    </div>
                    <div style={{
                      maxHeight: '110px', overflowY: 'auto', fontSize: '11px', color: '#c9cde0',
                      fontFamily: 'Consolas, monospace', marginBottom: '8px',
                    }}>
                      {m.projectFiles.map(f => <div key={f.path}>{f.path}</div>)}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: C.muted, marginBottom: '8px' }}>
                      <span>Sub-folder (optional):</span>
                      <input
                        value={m.projectName || ''}
                        placeholder="empty = open folder"
                        onChange={(e) => patchMessage(i, { projectName: e.target.value })}
                        disabled={m.projectStatus !== 'ready'}
                        style={{
                          flex: 1, minWidth: 0, background: C.panel, color: C.text, border: `1px solid ${C.border}`,
                          borderRadius: '6px', padding: '3px 6px', fontSize: '11px', outline: 'none',
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                      <span
                        onClick={m.projectStatus === 'ready' ? () => createProject(i) : undefined}
                        style={{
                          ...pillStyle, display: 'inline-flex', color: '#fff', borderColor: C.accent,
                          background: m.projectStatus === 'ready' ? C.accent : '#2a2e3d',
                          cursor: m.projectStatus === 'ready' ? 'pointer' : 'default',
                        }}
                      >
                        {m.projectStatus === 'creating' ? 'Creating…' : m.projectStatus === 'done' ? '✓ Created' : 'Create project'}
                      </span>
                      {m.projectStatus === 'done' && m.projectRoot && (
                        <span
                          onClick={m.fixStatus === 'running' ? undefined : () => runAndFix(i)}
                          title="Installs packages, starts the app and lets the AI repair errors (up to 3 times)"
                          style={{
                            ...pillStyle, display: 'inline-flex', color: '#fff', borderColor: '#2f8f5b',
                            background: m.fixStatus === 'running' ? '#2a2e3d' : '#2f8f5b',
                            cursor: m.fixStatus === 'running' ? 'default' : 'pointer',
                          }}
                        >
                          {m.fixStatus === 'running' ? 'Running…' : (m.fixStatus ? '▶ Run & fix again' : '▶ Run & fix')}
                        </span>
                      )}
                    </div>
                    {m.projectNote && (
                      <div style={{ fontSize: '11px', marginTop: '6px', color: m.projectStatus === 'done' ? '#7ee2a8' : '#ff9aa8' }}>
                        {m.projectNote}
                      </div>
                    )}
                    {m.fixLog && m.fixLog.length > 0 && (
                      <div style={{
                        marginTop: '8px', maxHeight: '160px', overflowY: 'auto', background: '#0d0f16',
                        border: `1px solid ${C.border}`, borderRadius: '6px', padding: '6px 8px',
                        fontSize: '11px', fontFamily: 'Consolas, monospace', whiteSpace: 'pre-wrap',
                        color: m.fixStatus === 'ok' ? '#7ee2a8' : (m.fixStatus === 'failed' ? '#ff9aa8' : '#c9cde0'),
                      }}>
                        {m.fixLog.map((l, k) => <div key={k}>{l}</div>)}
                      </div>
                    )}
                    {m.fixStatus === 'ok' && (
                      <div style={{ fontSize: '11px', marginTop: '6px', color: C.muted }}>
                        Open a terminal in the project folder, run <b style={{ color: '#a99dff' }}>npm start</b>, then open http://localhost:3001 in your browser.
                      </div>
                    )}
                  </div>
                )}
                {m.role === 'user' && editingIndex !== i && !loading && (
                  <span onClick={() => startEdit(i)} style={actionLinkStyle} title="Edit this message and ask again">✎ Edit</span>
                )}
                {m.role === 'assistant' && i === lastIndex && !loading && (
                  <span onClick={retry} style={actionLinkStyle} title="Ask the same question again">↻ Retry</span>
                )}
              </div>
            ))}
            {loading && <div style={{ color: C.muted, fontSize: '12px', fontStyle: 'italic' }}>Thinking… a local model on CPU can take a minute or two</div>}
            <div ref={endRef} />
          </>
        )}

        {tab === 'context' && (
          <div>
            <div style={{ color: C.muted, fontSize: '12px', marginBottom: '10px' }}>
              Files that will be sent with your next message:
            </div>
            {contextFiles.length === 0 && (
              <div style={{ color: '#5d6278', fontSize: '12px' }}>Nothing attached yet. Use + in the chat box.</div>
            )}
            {contextFiles.map(f => (
              <div key={f.path} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: C.panel, border: `1px solid ${C.border}`, borderRadius: '8px',
                padding: '8px 10px', marginBottom: '6px', fontSize: '12px', color: C.text,
              }}>
                <span title={f.path}>📄 {f.name || getFileName(f.path)}</span>
                {attachments.some(a => a.path === f.path) && (
                  <span onClick={() => removeAttachment(f.path)} style={{ cursor: 'pointer', color: C.muted }}>✕</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Attachment chips */}
      {attachments.length > 0 && tab === 'chat' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '8px 12px 0 12px' }}>
          {attachments.map(a => (
            <span key={a.path} style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: C.card, color: '#c9cde0', fontSize: '11px',
              padding: '3px 9px', borderRadius: '10px', border: `1px solid ${C.border}`,
            }}>
              📄 {a.name}
              <span onClick={() => removeAttachment(a.path)} style={{ cursor: 'pointer', color: C.muted }}>✕</span>
            </span>
          ))}
        </div>
      )}

      {/* Composer */}
      <div style={{ padding: '10px 12px 12px 12px', flexShrink: 0 }}>
        <div style={{
          background: C.panel, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '10px',
        }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask AI anything..."
            disabled={!model}
            rows={2}
            style={{
              width: '100%', background: 'transparent', border: 'none', outline: 'none',
              color: C.text, fontSize: '13px', resize: 'none', boxSizing: 'border-box',
              fontFamily: 'inherit',
            }}
          />
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginTop: '6px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
              {/* + attach */}
              <div style={{ position: 'relative' }}>
                <span
                  onClick={() => setShowAttachMenu(s => !s)}
                  title="Attach"
                  style={{
                    width: '26px', height: '26px', borderRadius: '50%', background: C.card,
                    color: '#c9cde0', border: `1px solid ${C.border}`, display: 'flex',
                    alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '15px',
                  }}
                >+</span>

                {showAttachMenu && (
                  <>
                    <div onClick={() => setShowAttachMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
                    <div style={{ position: 'absolute', bottom: '32px', left: 0, zIndex: 100, minWidth: '230px', ...menuStyle }}>
                      <div
                        onClick={activeFile ? attachActive : undefined}
                        onMouseEnter={(e) => activeFile && hover(e, true)}
                        onMouseLeave={(e) => hover(e, false)}
                        style={{ ...menuItemStyle, color: activeFile ? '#d5d8e8' : '#555a70', cursor: activeFile ? 'pointer' : 'default' }}
                      >
                        📄 {activeFile ? `Current file (${activeFile.name || getFileName(activeFile.path)})` : 'Current file (none open)'}
                      </div>

                      {openFiles.length > 0 && (
                        <>
                          <div style={{ padding: '6px 12px 2px', color: '#6b7088', fontSize: '10px', borderTop: `1px solid ${C.border}` }}>
                            OPEN FILES
                          </div>
                          {openFiles.map(f => (
                            <div
                              key={f.path}
                              onClick={() => toggleOpenFile(f)}
                              onMouseEnter={(e) => hover(e, true)}
                              onMouseLeave={(e) => hover(e, false)}
                              style={{ ...menuItemStyle, color: attachments.some(a => a.path === f.path) ? '#a99dff' : '#d5d8e8' }}
                            >
                              <span style={{ width: '12px' }}>{attachments.some(a => a.path === f.path) ? '✓' : ''}</span>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {f.name || getFileName(f.path)}
                              </span>
                            </div>
                          ))}
                        </>
                      )}

                      <div
                        onClick={browseComputer}
                        onMouseEnter={(e) => hover(e, true)}
                        onMouseLeave={(e) => hover(e, false)}
                        style={{ ...menuItemStyle, borderTop: `1px solid ${C.border}` }}
                      >
                        📂 Browse computer…
                      </div>
                    </div>
                  </>
                )}
              </div>

              <PillMenu value={scope} options={SCOPES} onChange={setScope} title="Which file is sent with every message" />
              <ModelSelector selected={model} onSelect={onModelChange} />
            </div>

            <button
              onClick={send}
              disabled={!canSend}
              title="Send"
              style={{
                width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0,
                background: canSend ? C.accent : '#2a2e3d', color: '#fff', border: 'none',
                cursor: canSend ? 'pointer' : 'default', fontSize: '14px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >➤</button>
          </div>
        </div>
        <div style={{ color: '#5d6278', fontSize: '10px', marginTop: '6px', textAlign: 'center' }}>
          AI may make mistakes. Double-check responses.
        </div>
      </div>
    </div>
  );
}

export default ChatPanel;