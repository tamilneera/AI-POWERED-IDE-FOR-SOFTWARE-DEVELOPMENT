import { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';

const FILE_PATH = 'C:/Users/ANAND/Projects/AI-POWERED-IDE-FOR-SOFTWARE-DEVELOPMENT/test.txt';
const BACKEND_URL = 'http://10.231.208.94:5000'; // same IP as before

function App() {
  const [code, setCode] = useState('// Loading...');
  const [language, setLanguage] = useState('javascript');
  const [status, setStatus] = useState('');

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/files/read?path=${encodeURIComponent(FILE_PATH)}`)
      .then(res => res.json())
      .then(data => setCode(data.content || '// (empty file)'))
      .catch(err => setStatus('Failed to load file: ' + err.message));
  }, []);

  const handleSave = async () => {
    setStatus('Saving...');
    try {
      const response = await fetch(`${BACKEND_URL}/api/files/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: FILE_PATH, content: code })
      });
      const data = await response.json();
      setStatus(data.success ? 'Saved successfully ✓' : 'Save failed: ' + data.error);
    } catch (err) {
      setStatus('Save failed: ' + err.message);
    }
  };

  return (
    <div style={{ height: '100vh' }}>
      <div style={{ background: '#1e1e1e', padding: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <h3 style={{ color: 'white', margin: 0 }}>AI-Powered IDE</h3>

        <select value={language} onChange={(e) => setLanguage(e.target.value)}>
          <option value="javascript">JavaScript</option>
          <option value="python">Python</option>
          <option value="java">Java</option>
        </select>

        <button onClick={handleSave} style={{ padding: '4px 12px' }}>Save</button>
        <span style={{ color: '#0f0' }}>{status}</span>
      </div>
      <Editor
        height="90vh"
        language={language}
        value={code}
        onChange={(value) => setCode(value)}
        theme="vs-dark"
      />
    </div>
  );
}

export default App;