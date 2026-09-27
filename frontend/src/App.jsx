import { useState } from 'react';
import Editor from '@monaco-editor/react';
import FileExplorer from './FileExplorer';
import BottomPanel from './Components/BottomPanel';
import Settings from './Components/Settings';

const BACKEND_URL = 'http://10.150.71.94:5000';

function MenuItem({ label, active, onClick }) {
  return (
    <span
      onClick={onClick}
      style={{
        padding: '4px 10px',
        color: '#ccc',
        cursor: 'pointer',
        fontSize: '13px',
        borderRadius: '3px',
        background: active ? '#333' : 'transparent',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = '#2a2d2e'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      {label}
    </span>
  );
}

function getLanguageFromPath(filePath) {
  const ext = filePath.split('.').pop();
  if (ext === 'py') return 'python';
  if (ext === 'java') return 'java';
  if (ext === 'ts' || ext === 'tsx') return 'typescript';
  if (ext === 'json') return 'json';
  if (ext === 'css') return 'css';
  if (ext === 'html') return 'html';
  return 'javascript';
}

function getFileName(filePath) {
  return filePath.split(/[\\/]/).pop();
}

function App() {
  const [status, setStatus] = useState('');
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [isTerminalMaximized, setIsTerminalMaximized] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editorTheme, setEditorTheme] = useState('vs-dark');
  const [fontSize, setFontSize] = useState(14);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [showSaveAsModal, setShowSaveAsModal] = useState(false);
  const [saveAsPath, setSaveAsPath] = useState('');

  // Tabs: array of { path, name, content, language, isDirty }
  const [openFiles, setOpenFiles] = useState([]);
  const [activeFile, setActiveFile] = useState(null); // path of the active tab

  const activeTab = openFiles.find(f => f.path === activeFile);

  const handleFileSelect = (filePath) => {
    const existing = openFiles.find(f => f.path === filePath);
    if (existing) {
      setActiveFile(filePath);
      return;
    }

    setStatus('Loading file...');
    fetch(`${BACKEND_URL}/api/files/read?path=${encodeURIComponent(filePath)}`)
      .then(res => res.json())
      .then(data => {
        const newTab = {
          path: filePath,
          name: getFileName(filePath),
          content: data.content || '',
          language: getLanguageFromPath(filePath),
          isDirty: false,
        };
        setOpenFiles(prev => [...prev, newTab]);
        setActiveFile(filePath);
        setStatus('');
      })
      .catch(err => setStatus('Failed to load: ' + err.message));
  };

  const handleCodeChange = (value) => {
    if (!activeFile) return;
    setOpenFiles(prev => prev.map(f =>
      f.path === activeFile ? { ...f, content: value, isDirty: true } : f
    ));
  };

  const handleCloseTab = (e, filePath) => {
    e.stopPropagation();
    const tab = openFiles.find(f => f.path === filePath);
    if (tab && tab.isDirty) {
      const confirmClose = window.confirm(`${tab.name} has unsaved changes. Close anyway?`);
      if (!confirmClose) return;
    }
    setOpenFiles(prev => {
      const next = prev.filter(f => f.path !== filePath);
      if (activeFile === filePath) {
        setActiveFile(next.length > 0 ? next[next.length - 1].path : null);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!activeTab) {
      setStatus('No file selected');
      return;
    }
    try {
      const response = await fetch(`${BACKEND_URL}/api/files/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: activeTab.path, content: activeTab.content })
      });
      const data = await response.json();
      if (data.success) {
        setOpenFiles(prev => prev.map(f =>
          f.path === activeTab.path ? { ...f, isDirty: false } : f
        ));
        setStatus('');
      } else {
        setStatus('Save failed: ' + data.error);
      }
    } catch (err) {
      setStatus('Save failed: ' + err.message);
    }
  };

  const openSaveAsModal = () => {
    if (!activeTab) {
      setStatus('No file selected');
      return;
    }
    setSaveAsPath(activeTab.path);
    setShowSaveAsModal(true);
  };

  const submitSaveAs = async () => {
    const newPath = saveAsPath.trim();
    setShowSaveAsModal(false);
    if (!newPath || !activeTab) return;

    if (newPath === activeTab.path) {
      handleSave();
      return;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/files/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newPath, content: activeTab.content })
      });
      const data = await response.json();
      if (data.success) {
        const existing = openFiles.find(f => f.path === newPath);
        if (existing) {
          setOpenFiles(prev => prev.map(f =>
            f.path === newPath ? { ...f, content: activeTab.content, isDirty: false } : f
          ));
        } else {
          const newTab = {
            path: newPath,
            name: getFileName(newPath),
            content: activeTab.content,
            language: getLanguageFromPath(newPath),
            isDirty: false,
          };
          setOpenFiles(prev => [...prev, newTab]);
        }
        setActiveFile(newPath);
        setStatus('');
      } else {
        setStatus('Save failed: ' + data.error);
      }
    } catch (err) {
      setStatus('Save failed: ' + err.message);
    }
  };

  const handleKeyDown = (e) => {
    if (e.ctrlKey && e.key === '`') {
      e.preventDefault();
      setIsTerminalOpen((prev) => !prev);
    }
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
  };

  const toggleMaximize = () => {
    setIsTerminalMaximized((prev) => !prev);
  };

  let terminalHeight = '25vh';
  if (isTerminalOpen) {
    terminalHeight = isTerminalMaximized ? '80vh' : '25vh';
  }

  return (
    <div
      style={{ display: 'flex', height: '100vh', width: '100%', background: '#1e1e1e' }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <FileExplorer onFileSelect={handleFileSelect} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: '#1e1e1e' }}>

        {/* Menu row: File / Settings / Terminal */}
        <div style={{ background: '#1e1e1e', padding: '8px', display: 'flex', alignItems: 'center', gap: '4px', position: 'relative', borderBottom: '1px solid #333' }}>
          <div style={{ position: 'relative' }}>
            <MenuItem label="File" active={showFileMenu} onClick={() => setShowFileMenu((prev) => !prev)} />
            {showFileMenu && (
              <>
                <div onClick={() => setShowFileMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
                <div style={{
                  position: 'absolute', top: '100%', left: 0, marginTop: '4px',
                  background: '#252526', border: '1px solid #444', borderRadius: '4px',
                  zIndex: 100, minWidth: '150px', boxShadow: '0 4px 10px rgba(0,0,0,0.4)'
                }}>
                  <div
                    onClick={() => { handleSave(); setShowFileMenu(false); }}
                    style={{ padding: '8px 14px', color: '#ccc', cursor: 'pointer' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#333')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    Save
                  </div>
                  <div
                    onClick={() => { openSaveAsModal(); setShowFileMenu(false); }}
                    style={{ padding: '8px 14px', color: '#ccc', cursor: 'pointer' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#333')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    Save As
                  </div>
                </div>
              </>
            )}
          </div>

          <MenuItem label="Settings" active={showSettings} onClick={() => setShowSettings(true)} />
          <MenuItem label="Terminal" active={isTerminalOpen} onClick={() => setIsTerminalOpen((prev) => !prev)} />

          <h3 style={{ color: 'white', margin: '0 0 0 12px', fontSize: '15px' }}>AI-Powered IDE</h3>

          <span style={{ color: '#f66', marginLeft: 'auto' }}>{status}</span>
        </div>

        {/* Tab bar */}
        {openFiles.length > 0 && (
          <div style={{ display: 'flex', background: '#252526', borderBottom: '1px solid #333', overflowX: 'auto', flexShrink: 0 }}>
            {openFiles.map((f) => (
              <div
                key={f.path}
                onClick={() => setActiveFile(f.path)}
                title={f.path}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '8px 10px', cursor: 'pointer',
                  background: activeFile === f.path ? '#1e1e1e' : 'transparent',
                  borderRight: '1px solid #333',
                  borderTop: activeFile === f.path ? '2px solid #007acc' : '2px solid transparent',
                  color: activeFile === f.path ? '#fff' : '#999',
                  fontSize: '13px',
                  whiteSpace: 'nowrap',
                }}
              >
                <span>{f.name}{f.isDirty ? ' •' : ''}</span>
                <span
                  onClick={(e) => handleCloseTab(e, f.path)}
                  style={{ fontSize: '11px', cursor: 'pointer', color: '#888' }}
                  title="Close"
                >
                  ✕
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Editor */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ flex: 1, minHeight: 0 }}>
            {activeTab ? (
              <Editor
                height="100%"
                language={activeTab.language}
                value={activeTab.content}
                onChange={handleCodeChange}
                theme={editorTheme}
                options={{ fontSize: fontSize }}
              />
            ) : (
              <div style={{ color: '#666', padding: '20px', fontSize: '14px' }}>
                No file open — select one from the Explorer.
              </div>
            )}
          </div>

          {isTerminalOpen && (
            <div style={{ height: terminalHeight, borderTop: '2px solid #333', width: '100%', flexShrink: 0 }}>
              <BottomPanel
                isMaximized={isTerminalMaximized}
                onToggleMaximize={toggleMaximize}
              />
            </div>
          )}
        </div>
      </div>

      {showSaveAsModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div style={{ background: '#252526', padding: '20px', borderRadius: '8px', width: '400px', color: '#ccc' }}>
            <h3 style={{ marginTop: 0, color: 'white' }}>Save As</h3>
            <input
              autoFocus
              value={saveAsPath}
              onChange={(e) => setSaveAsPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitSaveAs()}
              style={{ width: '100%', padding: '6px', marginBottom: '16px', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setShowSaveAsModal(false)} style={{ padding: '4px 12px' }}>Cancel</button>
              <button onClick={submitSaveAs} style={{ padding: '4px 12px' }}>Save</button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <Settings
          onClose={() => setShowSettings(false)}
          onApply={({ theme, fontSize }) => {
            setEditorTheme(theme === 'dark' ? 'vs-dark' : 'vs');
            setFontSize(fontSize);
            setShowSettings(false);
          }}
        />
      )}
    </div>
  );
}

export default App;