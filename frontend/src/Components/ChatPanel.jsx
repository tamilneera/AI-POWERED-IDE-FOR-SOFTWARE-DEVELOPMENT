import { useState, useRef, useEffect } from 'react';
import { BACKEND_URL } from '../config';
import ModelSelector from './ModelSelector';
import { C } from '../theme';

const MAX_FILE_CHARS = 4000; // keeps local models from choking on huge files

// The AI always behaves like a coding partner: explain code, find and fix errors, answer questions.
const SYSTEM_PROMPT = `You are a coding assistant inside an IDE, helping a student. Use only facts from the code given; do not mention keywords or languages that are not in it.
When given code, first check it line by line for real errors (missing colon, bracket, quote, value, typos, bugs). Then answer in ONE of two ways:
A) NO errors: write "No problems found." then explain what the code does, step by step, in simple words. Do NOT show fixed code.
B) Errors found: list each error with its line, then give exactly ONE code block with the corrected code (it must differ from the original; if a value is missing add a placeholder such as 0), then one line saying what changed. If the user selected code, fix only the selection; otherwise give the full file.
For other questions, answer briefly with a short example. Use any file or errors given below only when relevant. Keep the whole answer under 150 words.`;
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

// Renders ```code``` blocks nicely; everything else stays plain text
function renderContent(text, onApply) {
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
    return <span key={i}>{part}</span>;
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

function ChatPanel({ model, onModelChange, onClose, openFiles = [], activeFile = null, getEditorContext, onApplyCode, onUndoCode }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('chat');
  const [scope, setScope] = useState('active');
  const [attachments, setAttachments] = useState([]); // manual: [{ path, name, content, language }]
  const [showAttachMenu, setShowAttachMenu] = useState(false);
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
      setMessages(prev => [...prev, { role: 'assistant', content: 'Could not read file: ' + err.message }]);
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

  // ---------- send ----------
  const send = async () => {
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
    if (ctx.selection && activeFileRef.current) {
      names.unshift(`selection in ${activeFileRef.current.name || getFileName(activeFileRef.current.path)}`);
    }

    const userMsg = { role: 'user', content: input, files: names };
    const askedFix = FIX_INTENT.test(input);
    const askedFile = activeFileRef.current;
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setAttachments([]);
    setLoading(true);

    const selectionRange = ctx.selection ? (ctx.range || null) : null;
    const parts = [SYSTEM_PROMPT];
    if (ctx.selection) {
      parts.push(`The user has this code SELECTED in the editor (file: ${activeFile ? (activeFile.name || getFileName(activeFile.path)) : 'unknown'}):\n\`\`\`\n${ctx.selection.slice(0, MAX_FILE_CHARS)}\n\`\`\``);
    }
    if (ctx.problems && ctx.problems.length > 0) {
      const list = ctx.problems.slice(0, 15)
        .map(p => `- ${p.severity === 8 ? 'ERROR' : 'WARNING'} at line ${p.line}, column ${p.column}: ${p.message}`)
        .join('\n');
      parts.push(`The IDE reports these problems in the active file (${activeFile ? (activeFile.name || getFileName(activeFile.path)) : 'unknown'}):\n${list}`);
    }
    files.forEach(f => {
      const content = (f.content || '').length > MAX_FILE_CHARS
        ? f.content.slice(0, MAX_FILE_CHARS) + '\n... [file truncated]'
        : (f.content || '');
      parts.push(`File: ${f.path}\n\`\`\`${f.language || ''}\n${content}\n\`\`\``);
    });

    const cleanMessages = newMessages.slice(-6).map(({ role, content }) => ({ role, content })); // last 6 only: small models have a small context window
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
        body: JSON.stringify({
          provider: model.provider,
          model: model.model,
          messages: requestMessages,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      console.log(`[AI chat] answered in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      if (data.reply) {
        const reply = data.reply;
        const blocks = extractCodeBlocks(reply);
        const fixCode = blocks.length ? blocks[blocks.length - 1] : '';
        // the message goes at index newMessages.length (user message is at newMessages.length - 1)
        const msgIndex = newMessages.length;
        setMessages(prev => [...prev, {
          role: 'assistant', content: reply,
          filePath: askedFile ? askedFile.path : null,
          selectionRange,
        }]);

        // "fix this" -> apply automatically, but only when it is clearly safe:
        //  - a selection was fixed, or
        //  - the code block looks like the whole file (not a small snippet)
        if (askedFix && fixCode && askedFile) {
          const fileLines = lineCount(askedFile.content);
          const looksComplete = selectionRange || fileLines <= 6 || lineCount(fixCode) >= fileLines * 0.6;
          if (looksComplete && fixCode.trim() !== (askedFile.content || '').trim()) {
            setTimeout(() => applyFix(msgIndex, fixCode, true, { filePath: askedFile.path, selectionRange }), 0);
          }
        }
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + (data.error || 'no reply') }]);
      }
    } catch (err) {
      clearTimeout(timeout);
      const msg = err.name === 'AbortError'
        ? `No answer after 5 minutes (model: ${model.model}, sent ${sentChars} characters). Run "ollama ps" to check the model is loaded, and try a smaller selection.`
        : err.message;
      console.log(`[AI chat] failed after ${((Date.now() - t0) / 1000).toFixed(1)}s:`, err.name, err.message);
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + msg }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const contextFiles = buildContextFiles();
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
                <div style={{
                  maxWidth: '90%',
                  background: m.role === 'user' ? C.accentSoft : C.panel,
                  border: `1px solid ${m.role === 'user' ? '#3a3480' : C.border}`,
                  color: C.text, padding: '9px 12px', borderRadius: '12px',
                  whiteSpace: 'pre-wrap', lineHeight: 1.55, wordBreak: 'break-word',
                }}>
                  {renderContent(m.content, m.role === 'assistant' && !m.content.startsWith('Error:')
                    ? (code) => applyFix(i, code, false, m) : null)}
                </div>
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