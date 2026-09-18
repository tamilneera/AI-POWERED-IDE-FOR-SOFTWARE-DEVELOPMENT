import { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import FileExplorer from './FileExplorer';

const BACKEND_URL = 'http://10.231.208.94:5000'; // same IP

function App() {
  const [code, setCode] = useState('// Select a file from the explorer');
  const [language, setLanguage] = useState('javascript');
  const [status, setStatus] = useState('');
  const [currentFile, setCurrentFile] = useState(null);

  const handleFileSelect = (filePath) => {
    setCurrentFile(filePath);
    setStatus('Loading file...');
    fetch(`${BACKEND_URL}/api/files/read?path=${encodeURIComponent(filePath)}`)
      .then(res => res.json())
      .then(data => {
        setCode(data.content || '');
        setStatus('');
        const ext = filePath.split('.').pop();
        if (ext === 'py') setLanguage('python');
        else if (ext === 'java') setLanguage('java');
        else setLanguage('javascript');
      })
      .catch(err => setStatus('Failed to load: ' + err.message));
  };

  const handleSave = async () => {
    if (!currentFile) {
      setStatus('No file selected');
      return;
    }
    setStatus('Saving...');
    try {
      const response = await fetch(`${BACKEND_URL}/api/files/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: currentFile, content: code })
      });
      const data = await response.json();
      setStatus(data.success ? 'Saved successfully ✓' : 'Save failed: ' + data.error);
    } catch (err) {
      setStatus('Save failed: ' + err.message);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <FileExplorer onFileSelect={handleFileSelect} />
      <div style={{ flex: 1 }}>
        <div style={{ background: '#1e1e1e', padding: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h3 style={{ color: 'white', margin: 0 }}>AI-Powered IDE</h3>
          <span style={{ color: '#aaa', fontSize: '12px' }}>{currentFile || 'No file open'}</span>
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
    </div>
  );
}

export default App;