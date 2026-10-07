import { useState, useRef, useEffect } from 'react';
import { BACKEND_URL } from '../config';
import ModelSelector from './ModelSelector';

function ChatPanel({ model, onModelChange, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView();
  }, [messages, loading]);

  const send = async () => {
    if (!input.trim() || !model) return;
    const userMsg = { role: 'user', content: input };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const res = await fetch(`${BACKEND_URL}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: model.provider,
          model: model.model,
          messages: newMessages,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      if (data.reply) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + (data.error || 'no reply') }]);
      }
    } catch (err) {
      clearTimeout(timeout);
      const msg = err.name === 'AbortError' ? 'Request timed out after 60s — is Ollama running?' : err.message;
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + msg }]);
    } finally {
      setLoading(false);
    }
  };

  const handleComposerKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#181818' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderBottom: '1px solid #2a2a2a', flexShrink: 0,
      }}>
        <span style={{ color: '#eee', fontSize: '13px', fontWeight: 600 }}>✦ AI Chat</span>
        {onClose && (
          <span onClick={onClose} style={{ color: '#888', cursor: 'pointer', fontSize: '14px' }} title="Close">✕</span>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px', fontSize: '13px' }}>
        {messages.length === 0 && (
          <div style={{ color: '#777', fontSize: '12px', lineHeight: 1.6 }}>
            Ask anything about your code — explanations, fixes, or general questions.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: '14px', display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '85%',
              background: m.role === 'user' ? '#2b5278' : '#2a2a2a',
              color: '#e0e0e0',
              padding: '8px 12px',
              borderRadius: '10px',
              whiteSpace: 'pre-wrap',
              lineHeight: 1.5,
            }}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ color: '#888', fontSize: '12px', fontStyle: 'italic' }}>Thinking…</div>
        )}
        <div ref={endRef} />
      </div>

      {/* Composer, Antigravity-style: textarea on top, model pill + send button below */}
      <div style={{ padding: '10px', borderTop: '1px solid #2a2a2a', flexShrink: 0 }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleComposerKeyDown}
          placeholder="Ask anything..."
          disabled={!model}
          rows={2}
          style={{
            width: '100%', padding: '10px', fontSize: '13px',
            background: '#242424', border: '1px solid #333', borderRadius: '8px', color: '#eee',
            resize: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px' }}>
          <ModelSelector selected={model} onSelect={onModelChange} />
          <button
            onClick={send}
            disabled={!model || loading || !input.trim()}
            title="Send"
            style={{
              width: '30px', height: '30px', borderRadius: '50%',
              background: (!model || loading || !input.trim()) ? '#333' : '#2b5278',
              color: '#fff', border: 'none', cursor: (!model || loading) ? 'default' : 'pointer',
              fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ➤
          </button>
        </div>
        <div style={{ color: '#666', fontSize: '10px', marginTop: '6px', textAlign: 'center' }}>
          AI may make mistakes. Double-check responses.
        </div>
      </div>
    </div>
  );
}

export default ChatPanel;