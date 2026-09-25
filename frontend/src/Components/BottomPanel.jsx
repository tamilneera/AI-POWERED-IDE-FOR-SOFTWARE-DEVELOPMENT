import React, { useState } from 'react';
import Terminal from './Terminal';

let nextId = 1;

export default function BottomPanel({ isMaximized, onToggleMaximize }) {
  const [tabs, setTabs] = useState([{ id: nextId, label: `Terminal ${nextId}` }]);
  const [activeId, setActiveId] = useState(tabs[0].id);
  const [activeView, setActiveView] = useState('terminal'); // 'problems' | 'terminal'

  const addTerminal = () => {
    nextId += 1;
    const newTab = { id: nextId, label: `Terminal ${nextId}` };
    setTabs((prev) => [...prev, newTab]);
    setActiveId(newTab.id);
    setActiveView('terminal');
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
        {['Problems', 'Terminal'].map((label) => {
          const view = label.toLowerCase();
          const isActive = activeView === view;
          return (
            <div
              key={label}
              onClick={() => setActiveView(view)}
              style={{
                padding: '6px 14px',
                fontSize: '12px',
                color: isActive ? '#fff' : '#969696',
                borderBottom: isActive ? '2px solid #007acc' : '2px solid transparent',
                cursor: 'pointer',
              }}
            >
              {label}
            </div>
          );
        })}

        {/* Maximize / restore toggle, pushed to the far right */}
        <div
          onClick={onToggleMaximize}
          title={isMaximized ? 'Restore Terminal Size' : 'Maximize Terminal'}
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

      {activeView === 'problems' && (
        <div style={{ padding: '10px', color: '#969696', fontSize: '12px' }}>
          No problems detected. (Wire this to the AI code-quality analysis results later.)
        </div>
      )}

      {activeView === 'terminal' && (
        <>
          {/* Terminal instance tabs */}
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

          {/* Only render the active terminal; keep others mounted but hidden to preserve sessions */}
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
        </>
      )}
    </div>
  );
}