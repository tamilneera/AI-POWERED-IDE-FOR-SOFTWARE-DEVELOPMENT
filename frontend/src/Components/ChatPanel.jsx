import { useState, useRef, useEffect } from 'react';
import { BACKEND_URL } from '../config';
import ModelSelector from './ModelSelector';
import { C } from '../theme';

const MAX_FILE_CHARS = 40000; // keeps local models from choking on huge files
const ASSISTANT_NAME = 'AI Assistant'; // change this one line to rename the panel

const MODES = [
  { id: 'auto', label: 'Auto', hint: '' },
  { id: 'explain', label: 'Explain', hint: 'Explain the attached code clearly, step by step, in simple language.' },
  { id: 'fix', label: 'Fix bugs', hint: 'Find bugs in the attached code and show the corrected code.' },
  { id: 'tests', label: 'Add tests', hint: 'Write unit tests for the attached code.' },
];

const SCOPES = [
  { id: 'none', label: 'No auto-context' },
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

// Renders ```code``` blocks nicely; everything else stays plain text
function renderContent(text) {
  return text.split('```').map((part, i) => {
    if (i % 2 === 1) {
      const nl = part.indexOf('\n');
      const code = nl >= 0 ? part.slice(nl + 1) : part;
      return (
        <pre key={i} style={{
          background: '#0d0f16', border: `1px solid ${C.border}`, borderRadius: '6px',
          padding: '8px 10px', margin: '6px 0', overflowX: 'auto',
          fontSize: '12px', fontFamily: 'Consolas, monospace', color: '#d6dcff',
        }}>
          <code>{code}</code>
        </pre>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

const getFileName = (path) => path.split(/[\\/]/).pop();

function ChatPanel({ model, onModelChange, onClose, openFiles = [], activeFile = null }) {
  const [messages, setMessages] = useState([]); // [{ role, content, files?, ctx?, hint?, isError? }]
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('chat');
  const [mode, setMode] = useState('auto');
  const [scope, setScope] = useState('none');
  const [attachments, setAttachments] = useState([]); // manual: [{ path, name, content, language }]
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editText, setEditText] = useState('');
  const endRef = useRef(null);

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

  const explainCurrentFile = () => {
    if (!activeFile) return;
    attachActive();
    setMode('explain');
    setInput('Explain this file');
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

  // ---------- talking to the backend ----------
  // Takes the full chat history (ending with a user message) and appends the AI reply or a visible error.
  // The files and mode used are read from the last user message, so Retry and Edit reuse them.
  const requestReply = async (history) => {
    setLoading(true);

    const lastUser = [...history].reverse().find(m => m.role === 'user');
    const files = lastUser?.ctx || [];
    const modeHint = lastUser?.hint || '';

    const parts = [];
    if (modeHint) parts.push(modeHint);
    files.forEach(f => {
      const content = (f.content || '').length > MAX_FILE_CHARS
        ? f.content.slice(0, MAX_FILE_CHARS) + '\n... [file truncated]'
        : (f.content || '');
      parts.push(`File: ${f.path}\n\`\`\`${f.language || ''}\n${content}\n\`\`\``);
    });

    const cleanMessages = history
      .filter(m => !m.isError)
      .map(({ role, content }) => ({ role, content }));
    const requestMessages = parts.length
      ? [{ role: 'system', content: parts.join('\n\n') }, ...cleanMessages]
      : cleanMessages;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);

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
      if (data.reply) {
        setMessages([...history, { role: 'assistant', content: data.reply }]);
      } else {
        setMessages([...history, { role: 'assistant', content: 'Error: ' + (data.error || 'no reply'), isError: true }]);
      }
    } catch (err) {
      clearTimeout(timeout);
      const msg = err.name === 'AbortError'
        ? 'Request timed out — the model may still be loading. Press Retry.'
        : err.message;
      setMessages([...history, { role: 'assistant', content: 'Error: ' + msg, isError: true }]);
    } finally {
      setLoading(false);
    }
  };

  // ---------- send / retry / edit ----------
  const send = () => {
    if (!input.trim() || !model || loading) return;

    const files = buildContextFiles();
    const hint = MODES.find(m => m.id === mode)?.hint || '';

    const userMsg = {
      role: 'user',
      content: input,
      files: files.map(f => f.name || getFileName(f.path)), // shown under the bubble
      ctx: files,                                           // used again on Retry / Edit
      hint,
    };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput('');
    setAttachments([]);
    requestReply(history);
  };

  // Retry: drop everything after the last user message and ask again
  const retry = () => {
    if (loading || !model) return;
    let lastUser = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { lastUser = i; break; }
    }
    if (lastUser === -1) return;
    const history = messages.slice(0, lastUser + 1);
    setMessages(history);
    requestReply(history);
  };

  const startEdit = (index) => {
    if (loading) return;
    setEditingIndex(index);
    setEditText(messages[index].content);
  };

  // Save edit: cut the chat back to before this message, replace its text, ask again
  const saveEdit = () => {
    const text = editText.trim();
    if (!text || loading || !model) return;
    const edited = { ...messages[editingIndex], content: text };
    const history = [...messages.slice(0, editingIndex), edited];
    setMessages(history);
    setEditingIndex(null);
    requestReply(history);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const contextFiles = buildContextFiles();
  const canSend = model && !loading && input.trim();
  const lastIndex = messages.length - 1;

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
                Ask anything about your code. Use <b style={{ color: '#a99dff' }}>+</b> to attach the file open in the
                editor, other open files, or any file from your computer. You can edit your messages and retry answers.
                {activeFile && (
                  <div style={{ marginTop: '12px' }}>
                    <span
                      onClick={explainCurrentFile}
                      style={{ ...pillStyle, display: 'inline-flex', color: '#a99dff', borderColor: C.accent }}
                    >
                      ✦ Explain {activeFile.name || getFileName(activeFile.path)}
                    </span>
                  </div>
                )}
              </div>
            )}

            {messages.map((m, i) => {
              const isUser = m.role === 'user';
              const isEditing = editingIndex === i;
              return (
                <div key={i} style={{
                  marginBottom: '14px', display: 'flex', flexDirection: 'column',
                  alignItems: isUser ? 'flex-end' : 'flex-start',
                }}>
                  {isEditing ? (
                    <div style={{ width: '100%' }}>
                      <textarea
                        autoFocus
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={3}
                        style={{
                          width: '100%', padding: '8px', fontSize: '13px', boxSizing: 'border-box',
                          background: C.panel, border: `1px solid ${C.accent}`, borderRadius: '10px',
                          color: C.text, fontFamily: 'inherit', resize: 'vertical', outline: 'none',
                        }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '6px' }}>
                        <button
                          onClick={() => setEditingIndex(null)}
                          style={{
                            padding: '4px 10px', fontSize: '12px', background: 'transparent',
                            color: C.muted, border: `1px solid ${C.border}`, borderRadius: '6px', cursor: 'pointer',
                          }}
                        >Cancel</button>
                        <button
                          onClick={saveEdit}
                          style={{
                            padding: '4px 10px', fontSize: '12px', background: C.accent,
                            color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer',
                          }}
                        >Send</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{
                        maxWidth: '90%',
                        background: isUser ? C.accentSoft : (m.isError ? '#3a1d24' : C.panel),
                        border: `1px solid ${isUser ? '#3a3480' : (m.isError ? '#5a2a35' : C.border)}`,
                        color: C.text, padding: '9px 12px', borderRadius: '12px',
                        whiteSpace: 'pre-wrap', lineHeight: 1.55, wordBreak: 'break-word',
                      }}>
                        {renderContent(m.content)}
                      </div>
                      {m.files && m.files.length > 0 && (
                        <div style={{ color: C.muted, fontSize: '10px', marginTop: '4px' }}>
                          📎 {m.files.join(', ')}
                        </div>
                      )}
                      {isUser && !loading && (
                        <span onClick={() => startEdit(i)} style={actionLinkStyle}>✎ Edit</span>
                      )}
                      {!isUser && i === lastIndex && !loading && (
                        <span onClick={retry} style={actionLinkStyle}>↻ Retry</span>
                      )}
                    </>
                  )}
                </div>
              );
            })}

            {loading && <div style={{ color: C.muted, fontSize: '12px', fontStyle: 'italic' }}>Thinking…</div>}
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

              <PillMenu value={scope} options={SCOPES} onChange={setScope} title="What context is sent automatically" />
              <PillMenu value={mode} options={MODES} onChange={setMode} title="What should the AI do" />
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