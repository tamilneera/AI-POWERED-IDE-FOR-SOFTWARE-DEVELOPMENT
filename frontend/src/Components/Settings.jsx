import { useState, useEffect } from 'react';
import { BACKEND_URL } from '../config';

const DEFAULT_SHORTCUTS = {
  save: 'Ctrl+S',
  saveAs: 'Ctrl+Shift+S',
  openFile: 'Ctrl+O',
  toggleTerminal: 'Ctrl+`',
};

function Settings({ onClose, onApply }) {
  const [theme, setTheme] = useState('dark');
  const [fontSize, setFontSize] = useState(14);
  const [wordWrap, setWordWrap] = useState(false);
  const [tabSize, setTabSize] = useState(2);
  const [minimap, setMinimap] = useState(true);
  const [shortcuts, setShortcuts] = useState(DEFAULT_SHORTCUTS);
  const [status, setStatus] = useState('');

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/settings`)
      .then(res => res.json())
      .then(data => {
        setTheme(data.theme || 'dark');
        setFontSize(data.font_size || 14);
        setWordWrap(!!data.word_wrap);
        setTabSize(data.tab_size || 2);
        setMinimap(data.minimap === undefined ? true : !!data.minimap);
        try {
          const parsed = JSON.parse(data.shortcuts_json || '{}');
          setShortcuts({ ...DEFAULT_SHORTCUTS, ...parsed });
        } catch {
          setShortcuts(DEFAULT_SHORTCUTS);
        }
      })
      .catch(err => setStatus('Failed to load settings: ' + err.message));
  }, []);

  const handleShortcutChange = (key, value) => {
    setShortcuts(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setStatus('Saving...');
    try {
      const response = await fetch(`${BACKEND_URL}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme,
          font_size: fontSize,
          word_wrap: wordWrap ? 1 : 0,
          tab_size: tabSize,
          minimap: minimap ? 1 : 0,
          shortcuts_json: JSON.stringify(shortcuts),
        })
      });
      const data = await response.json();
      if (data.success) {
        setStatus('Saved ✓');
        onApply({ theme, fontSize, wordWrap, tabSize, minimap, shortcuts });
      } else {
        setStatus('Save failed: ' + data.error);
      }
    } catch (err) {
      setStatus('Save failed: ' + err.message);
    }
  };

  const shortcutLabels = {
    save: 'Save',
    saveAs: 'Save As',
    openFile: 'Open File',
    toggleTerminal: 'Toggle Terminal',
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.6)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div style={{ background: '#171a24', padding: '20px', borderRadius: '8px', width: '360px', color: '#ccc', maxHeight: '85vh', overflowY: 'auto' }}>
        <h3 style={{ marginTop: 0, color: 'white' }}>Settings</h3>

        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '4px' }}>Theme</label>
          <select value={theme} onChange={(e) => setTheme(e.target.value)} style={{ width: '100%', padding: '4px' }}>
            <option value="dark">Dark (vs-dark)</option>
            <option value="light">Light (vs)</option>
          </select>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '4px' }}>Font Size: {fontSize}px</label>
          <input
            type="range" min="10" max="24" value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input type="checkbox" checked={wordWrap} onChange={(e) => setWordWrap(e.target.checked)} />
            Word Wrap
          </label>
        </div>

        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '4px' }}>Tab Size</label>
          <input
            type="number" min="1" max="8" value={tabSize}
            onChange={(e) => setTabSize(Number(e.target.value))}
            style={{ width: '60px', padding: '4px' }}
          />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input type="checkbox" checked={minimap} onChange={(e) => setMinimap(e.target.checked)} />
            Minimap
          </label>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>Keyboard Shortcuts</label>
          {Object.keys(DEFAULT_SHORTCUTS).map((key) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '12px', color: '#aaa' }}>{shortcutLabels[key]}</span>
              <input
                value={shortcuts[key]}
                onChange={(e) => handleShortcutChange(key, e.target.value)}
                placeholder="e.g. Ctrl+S"
                style={{ width: '110px', padding: '3px', fontSize: '12px' }}
              />
            </div>
          ))}
          <div style={{ fontSize: '11px', color: '#777', marginTop: '4px' }}>
            Type combos like Ctrl+S, Ctrl+Shift+S, Alt+Enter
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#0f0', fontSize: '12px' }}>{status}</span>
          <div>
            <button onClick={onClose} style={{ marginRight: '8px', padding: '4px 12px' }}>Cancel</button>
            <button onClick={handleSave} style={{ padding: '4px 12px' }}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Settings;