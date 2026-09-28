import React, { useState, useEffect, useRef } from 'react';
import Terminal from './Terminal';

let nextId = 1;

const VIEWS = ['Problems', 'Output', 'Debug Console', 'Terminal'];

function severityIcon(severity) {
  if (severity === 8) return '⊗';
  if (severity === 4) return '⚠';
  return 'ⓘ';
}

function severityColor(severity) {
  if (severity === 8) return '#f48771';
  if (severity === 4) return '#cca700';
  return '#3794ff';
}

export default function BottomPanel({
  isMaximized,
  onToggleMaximize,
  activeView,
  onViewChange,
  problems,
  onProblemClick,
  logs,
  onClearLogs,
}) {
  const [tabs, setTabs] = useState([{ id: nextId, label: `Terminal ${nextId}` }]);
  const [activeId, setActiveId] = useState(tabs[0].id);
  const logEndRef = useRef(null);

  // Keep the Output panel scrolled to the newest line
  useEffect(() => {
    if (activeView === 'output' && logEndRef.current) {
      logEndRef.current.scrollIntoView();
    }
  }, [logs.length, activeView]);

  const addTerminal = () => {
    nextId += 1;
    const newTab = { id: nextId, label: `Terminal ${nextId}` };
    setTabs((prev) => [...prev, newTab]);
    setActiveId(newTab.id);
    onViewChange('terminal');
  };

  const closeTerminal = (id) => {
    setTabs((prev) => {
      const filtered = prev.filter((t) => t.id !== id);
      if (activeId === id && filtered.length > 0) {
        setActiveId(filtered[filtered.length - 1].id);
      }
      return filtered;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#1e1e1e' }}>
      {/* Top-level view tabs, VS Code style */}
      <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #333', background: '#252526' }}>
        {VIEWS.map((label) => {
          const view = label.toLowerCase();
          const isActive = activeView === view;
          return (
            <div
              key={label}
              onClick={() => onViewChange(view)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                fontSize: '12px',
                color: isActive ? '#fff' : '#969696',
                borderBottom: isActive ? '2px solid #007acc' : '2px solid transparent',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {label}
              {view === 'problems' && problems.length > 0 && (
                <span
                  style={{
                    background: '#4d4d4d',
                    color: '#fff',
                    borderRadius: '8px',
                    padding: '0 6px',
                    fontSize: '10px',
                  }}
                >
                  {problems.length}
                </span>
              )}
            </div>
          );
        })}

        {/* Maximize / restore toggle, pushed to the far right */}
        <div
          onClick={onToggleMaximize}
          title={isMaximized ? 'Restore Panel Size' : 'Maximize Panel'}
          style={{
            marginLeft: 'auto',
            padding: '4px 12px',
            fontSize: '14px',
            color: '#969696',
            cursor: 'pointer',
          }}
        >
          {isMaximized ? '🗗' : '🗖'}
        </div>
      </div>

      {/* Problems */}
      {activeView === 'problems' && (
        <div style={{ flex: 1, overflowY: 'auto', fontSize: '12px' }}>
          {problems.length === 0 ? (
            <div style={{ padding: '10px', color: '#969696' }}>
              No problems have been detected in the current file.
            </div>
          ) : (
            problems.map((p, i) => (
              <div
                key={i}
                onClick={() => onProblemClick(p)}
                style={{ display: 'flex', gap: '8px', padding: '3px 10px', cursor: 'pointer', color: '#ccc' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#2a2d2e')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ color: severityColor(p.severity), width: '14px' }}>{severityIcon(p.severity)}</span>
                <span style={{ flex: 1 }}>
                  {p.message}
                  {(p.source || p.code) && (
                    <span style={{ color: '#888' }}>
                      {' '}
                      {p.source || ''}
                      {p.code ? ` (${p.code})` : ''}
                    </span>
                  )}
                </span>
                <span style={{ color: '#888', whiteSpace: 'nowrap' }}>
                  {p.file} [Ln {p.line}, Col {p.column}]
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Output */}
      {activeView === 'output' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '2px 10px', borderBottom: '1px solid #333' }}>
            <span onClick={onClearLogs} style={{ color: '#969696', fontSize: '12px', cursor: 'pointer' }}>
              Clear Output
            </span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 10px', fontFamily: 'Consolas, monospace', fontSize: '12px' }}>
            {logs.length === 0 ? (
              <div style={{ color: '#969696' }}>No output yet.</div>
            ) : (
              logs.map((l, i) => (
                <div key={i} style={{ color: l.level === 'error' ? '#f48771' : '#ccc', whiteSpace: 'pre-wrap' }}>
                  <span style={{ color: '#6a9955' }}>[{l.time}]</span> {l.text}
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {/* Debug Console */}
      {activeView === 'debug console' && (
        <div style={{ padding: '10px', color: '#969696', fontSize: '12px', overflowY: 'auto', flex: 1, fontFamily: 'monospace' }}>
          No active debug session. (Wire this to debugger output later.)
        </div>
      )}

      {/* Terminal: always mounted (just hidden) so sessions survive switching tabs */}
      <div
        style={{
          display: activeView === 'terminal' ? 'flex' : 'none',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', background: '#1e1e1e', borderBottom: '1px solid #333' }}>
          {tabs.map((tab) => (
            <div
              key={tab.id}
              onClick={() => setActiveId(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 10px',
                fontSize: '12px',
                color: activeId === tab.id ? '#fff' : '#969696',
                background: activeId === tab.id ? '#2d2d2d' : 'transparent',
                cursor: 'pointer',
              }}
            >
              {tab.label}
              {tabs.length > 1 && (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTerminal(tab.id);
                  }}
                  style={{ color: '#969696' }}
                >
                  ×
                </span>
              )}
            </div>
          ))}
          <div
            onClick={addTerminal}
            title="New Terminal"
            style={{ padding: '4px 10px', color: '#969696', cursor: 'pointer', fontSize: '14px' }}
          >
            +
          </div>
        </div>

        <div style={{ flex: 1, position: 'relative' }}>
          {tabs.map((tab) => (
            <div
              key={tab.id}
              style={{
                display: activeId === tab.id ? 'block' : 'none',
                position: 'absolute',
                inset: 0,
              }}
            >
              <Terminal />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}