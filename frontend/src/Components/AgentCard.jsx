import { useState, useRef, useEffect } from 'react';
import { C } from '../theme';
import { useRun, stopRun, stopServers, openUrl } from '../agent';

const small = { fontSize: '11px', color: C.muted, lineHeight: 1.5 };

const pill = (enabled, bg) => ({
  display: 'inline-flex', alignItems: 'center', padding: '4px 12px', borderRadius: '14px', fontSize: '11px',
  color: '#fff', background: enabled ? bg : '#2a2e3d', border: `1px solid ${enabled ? bg : C.border}`,
  cursor: enabled ? 'pointer' : 'default', userSelect: 'none',
});

const ICON = { running: '⏳', ok: '✔', failed: '✖', timeout: '✖' };

// one command with its live terminal output
function CommandRow({ it }) {
  const [open, setOpen] = useState(null); // null = automatic (open while running or failed, closed when ok)
  const boxRef = useRef(null);
  const shown = open === null ? (it.status !== 'ok') : open;
  const color = it.status === 'ok' ? '#7ee2a8' : (it.status === 'failed' || it.status === 'timeout' ? '#ff9aa8' : '#c9cde0');

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [it.out, shown]);

  const icon = it.server && it.status === 'running' ? '🟢' : ICON[it.status];
  const label = it.server && it.status === 'running'
    ? `running${it.url ? ' on ' + it.url : ''}`
    : (it.status === 'timeout' ? 'timed out' : it.status === 'failed' ? `failed${it.code !== null && it.code !== undefined ? ' (exit ' + it.code + ')' : ''}` : it.status === 'ok' ? 'done' : (it.server ? 'starting…' : 'running…'));

  return (
    <div style={{ margin: '6px 0' }}>
      <div onClick={() => setOpen(!shown)} style={{ cursor: 'pointer', fontSize: '12px', color: '#d5d8e8', display: 'flex', gap: '6px', alignItems: 'baseline' }}>
        <span>{icon}</span>
        <span style={{ fontFamily: 'Consolas, monospace', color: '#fff' }}>$ {it.command}</span>
        <span style={{ ...small, color }}>{it.cwd !== '.' ? `in ${it.cwd} · ` : ''}{label}</span>
        <span style={{ ...small, marginLeft: 'auto' }}>{shown ? '▾' : '▸'}</span>
      </div>
      {shown && (
        <div ref={boxRef} style={{
          marginTop: '3px', maxHeight: '130px', overflowY: 'auto', background: '#0d0f16',
          border: `1px solid ${C.border}`, borderRadius: '6px', padding: '5px 8px', fontSize: '11px',
          fontFamily: 'Consolas, monospace', color: '#c9cde0', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {it.out.trim() ? it.out : '(no output yet)'}
        </div>
      )}
    </div>
  );
}

function Item({ it }) {
  if (it.k === 'ai') return <div style={{ fontSize: '12px', color: '#c9cde0', margin: '6px 0', lineHeight: 1.5 }}>{it.text}</div>;
  if (it.k === 'file') {
    return (
      <div style={{ fontSize: '12px', color: '#d5d8e8', margin: '2px 0' }}>
        <span style={{ color: '#7ee2a8' }}>✔</span> {it.created ? 'Created' : 'Updated'}{' '}
        <span style={{ fontFamily: 'Consolas, monospace', color: '#fff' }}>{it.path}</span>
        <span style={small}> · {it.lines} lines</span>
      </div>
    );
  }
  if (it.k === 'http') {
    const ok = it.status >= 200 && it.status < 400;
    return (
      <div style={{ fontSize: '12px', margin: '3px 0', color: '#d5d8e8' }}>
        <span style={{ color: ok ? '#7ee2a8' : '#ff9aa8' }}>{ok ? '✔' : '✖'}</span>{' '}
        <span style={{ fontFamily: 'Consolas, monospace' }}>{it.method} {it.url.replace(/^https?:\/\//, '')}</span>
        <span style={{ ...small, color: ok ? '#7ee2a8' : '#ff9aa8' }}> → {it.status || 'no answer'}</span>
      </div>
    );
  }
  if (it.k === 'cmd') return <CommandRow it={it} />;
  return null;
}

export default function AgentCard({ id }) {
  const run = useRun(id);
  const endRef = useRef(null);
  const count = run ? run.items.length : 0;

  useEffect(() => {
    if (endRef.current) endRef.current.scrollIntoView({ block: 'nearest' });
  }, [count, run && run.status]);

  if (!run) {
    return <div style={{ ...small, marginTop: '8px' }}>This agent run belongs to an earlier session. Send the request again to start a new one.</div>;
  }

  const working = run.status === 'running';
  const chip = {
    running: { text: `Working · step ${run.step}/${run.max || '…'}`, color: '#a99dff' },
    done: { text: 'Finished', color: '#7ee2a8' },
    stopped: { text: 'Stopped', color: '#f0b429' },
    error: { text: 'Stopped with an error', color: '#ff9aa8' },
  }[run.status];

  return (
    <div style={{
      width: '92%', marginTop: '8px', background: C.card, border: `1px solid ${C.border}`,
      borderRadius: '10px', padding: '10px', boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
        <div style={{ color: '#fff', fontSize: '12px', fontWeight: 600 }}>🤖 Agent</div>
        <div style={{ fontSize: '11px', color: chip.color }}>{chip.text}</div>
      </div>

      {run.items.map((it, i) => <Item key={i} it={it} />)}

      {working && run.waiting > 0 && (
        <div style={{ ...small, color: '#f0b429', marginTop: '6px' }}>
          Waiting {run.waiting} s because the model's rate limit was reached. It continues by itself.
        </div>
      )}
      {working && run.waiting === 0 && (
        <div style={{ ...small, marginTop: '6px', fontStyle: 'italic' }}>Thinking…</div>
      )}
      {run.status === 'done' && (
        <div style={{ fontSize: '12px', color: '#d5d8e8', marginTop: '8px', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{run.summary}</div>
      )}
      {run.status === 'error' && (
        <div style={{ fontSize: '11px', color: '#ff9aa8', marginTop: '8px', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{run.error}</div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
        {working && <span onClick={() => stopRun(id)} style={pill(true, '#b5483f')}>■ Stop</span>}
        {run.url && <span onClick={() => openUrl(run.url)} style={pill(true, '#6d5ef5')}>🌐 Open {run.url.replace('http://', '')}</span>}
        {run.url && <span onClick={() => stopServers()} style={pill(true, '#555a70')}>Stop app</span>}
      </div>
      <div style={{ ...small, marginTop: '6px' }}>
        The agent writes files and runs npm commands in the open folder. Stopping the agent does not stop the app it started; use "Stop app".
      </div>
      <div ref={endRef} />
    </div>
  );
}