import { useState } from 'react';
import Editor from '@monaco-editor/react';
import FileExplorer from './FileExplorer';
import BottomPanel from './Components/BottomPanel';

const BACKEND_URL = 'http://10.158.205.94:5000';

function App() {
  const [code, setCode] = useState('// Select a file from the explorer');
  const [language, setLanguage] = useState('javascript');
  const [status, setStatus] = useState('');
  const [currentFile, setCurrentFile] = useState(null);
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [isTerminalMaximized, setIsTerminalMaximized] = useState(false);

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

  // Ctrl+` toggles the terminal, same shortcut as VS Code
  const handleKeyDown = (e) => {
    if (e.ctrlKey && e.key === '`') {
      e.preventDefault();
      setIsTerminalOpen((prev) => !prev);
    }
  };

  const toggleMaximize = () => {
    setIsTerminalMaximized((prev) => !prev);
  };

  // When maximized, editor gets a small sliver so the terminal takes most of the screen.
  // When terminal is closed entirely, editor gets full height.
  let editorHeight = '90vh';
  let terminalHeight = '25vh';
  if (isTerminalOpen) {
    editorHeight = isTerminalMaximized ? '10vh' : '65vh';
    terminalHeight = isTerminalMaximized ? '80vh' : '25vh';
  }

  return (
    <div
      style={{ display: 'flex', height: '100vh', width: '100%' }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <FileExplorer onFileSelect={handleFileSelect} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ background: '#1e1e1e', padding: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h3 style={{ color: 'white', margin: 0 }}>AI-Powered IDE</h3>
          <span style={{ color: '#aaa', fontSize: '12px' }}>{currentFile || 'No file open'}</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="javascript">JavaScript</option>
            <option value="python">Python</option>
            <option value="java">Java</option>
          </select>
          <button onClick={handleSave} style={{ padding: '4px 12px' }}>Save</button>

          {/* Terminal toggle button, pushed to the right */}
          <button
            onClick={() => setIsTerminalOpen((prev) => !prev)}
            style={{
              padding: '4px 12px',
              marginLeft: 'auto',
              background: isTerminalOpen ? '#007acc' : '#333',
              color: 'white',
              border: 'none',
              borderRadius: '3px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            {isTerminalOpen ? 'Hide Terminal' : 'Show Terminal'}
          </button>

          <span style={{ color: '#0f0' }}>{status}</span>
        </div>

        <Editor
          height={editorHeight}
          language={language}
          value={code}
          onChange={(value) => setCode(value)}
          theme="vs-dark"
        />

        {isTerminalOpen && (
          <div style={{ height: terminalHeight, borderTop: '2px solid #333', width: '100%' }}>
            <BottomPanel
              isMaximized={isTerminalMaximized}
              onToggleMaximize={toggleMaximize}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;