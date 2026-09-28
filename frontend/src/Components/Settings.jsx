import { useState, useEffect } from 'react';
import { BACKEND_URL } from '../config';

function Settings({ onClose, onApply }) {
  const [theme, setTheme] = useState('dark');
  const [fontSize, setFontSize] = useState(14);
  const [status, setStatus] = useState('');

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/settings`)
      .then(res => res.json())
      .then(data => {
        setTheme(data.theme || 'dark');
        setFontSize(data.font_size || 14);
      })
      .catch(err => setStatus('Failed to load settings: ' + err.message));
  }, []);

  const handleSave = async () => {
    setStatus('Saving...');
    try {
      const response = await fetch(`${BACKEND_URL}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme, font_size: fontSize })
      });
      const data = await response.json();
      if (data.success) {
        setStatus('Saved ✓');
        onApply({ theme, fontSize });
      } else {
        setStatus('Save failed: ' + data.error);
      }
    } catch (err) {
      setStatus('Save failed: ' + err.message);
    }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.6)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div style={{ background: '#252526', padding: '20px', borderRadius: '8px', width: '320px', color: '#ccc' }}>
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