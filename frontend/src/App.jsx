import { useState, useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import FileExplorer from './FileExplorer';
import SearchPanel from './SearchPanel';
import WelcomeScreen from './WelcomeScreen';
import BottomPanel from './Components/BottomPanel';
import Settings from './Components/Settings';
import { BACKEND_URL } from './config';
import ChatPanel from './Components/ChatPanel';
import LayoutToggles from './Components/LayoutToggles';
import ResizeHandle from './Components/ResizeHandle';
import { useLayout } from './useLayout';
import { defineIdeTheme } from './theme';

const DEFAULT_WORKSPACE = '';

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
        background: active ? '#262a38' : 'transparent',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = '#262b3b'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      {label}
    </span>
  );
}

function DropdownItem({ label, shortcut, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{ display: 'flex', justifyContent: 'space-between', gap: '24px', padding: '8px 14px', color: '#ccc', cursor: 'pointer', fontSize: '13px' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#2a2650')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <span>{label}</span>
      <span style={{ color: '#888' }}>{shortcut}</span>
    </div>
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

const DEFAULT_SHORTCUTS = {
  save: 'Ctrl+S',
  saveAs: 'Ctrl+Shift+S',
  openFile: 'Ctrl+O',
  toggleTerminal: 'Ctrl+`',
};

function matchesShortcut(e, combo) {
  if (!combo) return false;
  const parts = combo.toLowerCase().split('+').map(p => p.trim());
  const key = parts[parts.length - 1];
  const ctrl = parts.includes('ctrl');
  const shift = parts.includes('shift');
  const alt = parts.includes('alt');
  return e.ctrlKey === ctrl && e.shiftKey === shift && e.altKey === alt && e.key.toLowerCase() === key;
}

function App() {
  const [status, setStatus] = useState('');
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [isTerminalMaximized, setIsTerminalMaximized] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);
  const [panelView, setPanelView] = useState('terminal');
  const [showSettings, setShowSettings] = useState(false);
  const [editorTheme, setEditorTheme] = useState('ide-dark');
  const [fontSize, setFontSize] = useState(14);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [showSaveAsModal, setShowSaveAsModal] = useState(false);
  const [saveAsPath, setSaveAsPath] = useState('');
  const [activeSidebar, setActiveSidebar] = useState('explorer');
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [shortcuts, setShortcuts] = useState(DEFAULT_SHORTCUTS);
  const [editorPrefs, setEditorPrefs] = useState({ wordWrap: false, tabSize: 2, minimap: true });

  const [markers, setMarkers] = useState([]);
  const [logs, setLogs] = useState([]);
  const editorRef = useRef(null);
  const [selectedModel, setSelectedModel] = useState(null);

  // layout: side bar / AI panel visibility + sizes (remembered between runs)
  // togglePanel is defined further down, so it is wrapped in an arrow (looked up only when Ctrl+J is pressed)
  const { layout, toggle: toggleLayout, resizeBy } = useLayout({ onTogglePanel: () => togglePanel() });

  const [workspacePath, setWorkspacePath] = useState(() => {
    try {
      return localStorage.getItem('workspacePath') || DEFAULT_WORKSPACE;
    } catch {
      return DEFAULT_WORKSPACE;
    }
  });

  const [openFiles, setOpenFiles] = useState([]);
  const [activeFile, setActiveFile] = useState(null);

  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null');
    } catch {
      return null;
    }
  });

  const activeTab = openFiles.find(f => f.path === activeFile);

  const log = (text, level = 'info') => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-499), { time, text, level }]);
  };

  useEffect(() => {
    setMarkers([]);
  }, [activeFile]);

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/settings`)
      .then(res => res.json())
      .then(data => {
        setEditorTheme(data.theme === 'light' ? 'vs' : 'ide-dark');
        setFontSize(data.font_size || 14);
        setEditorPrefs({
          wordWrap: !!data.word_wrap,
          tabSize: data.tab_size || 2,
          minimap: data.minimap === undefined ? true : !!data.minimap,
        });
        try {
          const parsed = JSON.parse(data.shortcuts_json || '{}');
          setShortcuts({ ...DEFAULT_SHORTCUTS, ...parsed });
        } catch {
          // keep defaults
        }
      })
      .catch(() => {
        // non-fatal — just keep built-in defaults
      });
  }, []);

  const problems = markers
    .filter(m => m.severity >= 2)
    .map(m => ({
      severity: m.severity,
      message: m.message,
      line: m.startLineNumber,
      column: m.startColumn,
      source: m.source,
      code: typeof m.code === 'object' && m.code !== null ? m.code.value : m.code,
      file: activeTab ? activeTab.name : '',
    }))
    .sort((a, b) => a.line - b.line);

  const errorCount = problems.filter(p => p.severity === 8).length;
  const warningCount = problems.filter(p => p.severity === 4).length;

  const handleProblemClick = (p) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.revealLineInCenter(p.line);
    editor.setPosition({ lineNumber: p.line, column: p.column });
    editor.focus();
  };

  const openPanel = (view) => {
    setPanelMounted(true);
    setIsTerminalOpen(true);
    if (view) setPanelView(view);
  };

  const togglePanel = () => {
    if (isTerminalOpen) {
      setIsTerminalOpen(false);
    } else {
      openPanel('terminal');
    }
  };

  // VS Code behaviour: clicking the active activity-bar icon hides the side bar
  const selectSidebar = (name) => {
    if (activeSidebar === name && layout.showSidebar) {
      toggleLayout('showSidebar');
    } else {
      setActiveSidebar(name);
      if (!layout.showSidebar) toggleLayout('showSidebar');
    }
  };

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
        log(`Opened ${filePath}`);
      })
      .catch(err => {
        setStatus('Failed to load: ' + err.message);
        log(`Failed to open ${filePath}: ${err.message}`, 'error');
      });
  };

  const handleOpenFile = async () => {
    if (!window.electronAPI) {
      setStatus('Open File works only in the desktop app');
      return;
    }
    const filePath = await window.electronAPI.openFileDialog();
    if (filePath) handleFileSelect(filePath);
  };

  const openFolderPath = (folder) => {
    if (openFiles.some(f => f.isDirty) && !window.confirm('You have unsaved changes. Open another folder anyway?')) return;
    setOpenFiles([]);
    setActiveFile(null);
    setWorkspacePath(folder);
    try {
      localStorage.setItem('workspacePath', folder);
      const recent = JSON.parse(localStorage.getItem('recentFolders') || '[]');
      const next = [folder, ...recent.filter(p => p !== folder)].slice(0, 8);
      localStorage.setItem('recentFolders', JSON.stringify(next));
    } catch {
      // ignore storage errors
    }
    setActiveSidebar('explorer');
    log(`Opened folder ${folder}`);
  };

  const handleOpenFolder = async () => {
    if (!window.electronAPI) {
      setStatus('Open Folder works only in the desktop app');
      return;
    }
    const folder = await window.electronAPI.openFolderDialog();
    if (!folder) return;
    openFolderPath(folder);
  };

  const handleCloseFolder = () => {
    if (openFiles.some(f => f.isDirty) && !window.confirm('You have unsaved changes. Close the folder anyway?')) return;
    setOpenFiles([]);
    setActiveFile(null);
    setWorkspacePath('');
    try {
      localStorage.removeItem('workspacePath');
    } catch {
      // ignore
    }
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
        log(`Saved ${activeTab.path}`);
      } else {
        setStatus('Save failed: ' + data.error);
        log(`Save failed for ${activeTab.path}: ${data.error}`, 'error');
      }
    } catch (err) {
      setStatus('Save failed: ' + err.message);
      log(`Save failed for ${activeTab.path}: ${err.message}`, 'error');
    }
  };

  const saveToPath = async (newPath) => {
    if (!activeTab) return;

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
        log(`Saved as ${newPath}`);
      } else {
        setStatus('Save failed: ' + data.error);
        log(`Save As failed for ${newPath}: ${data.error}`, 'error');
      }
    } catch (err) {
      setStatus('Save failed: ' + err.message);
      log(`Save As failed for ${newPath}: ${err.message}`, 'error');
    }
  };

  const handleSaveAs = async () => {
    if (!activeTab) {
      setStatus('No file selected');
      return;
    }
    if (window.electronAPI) {
      const chosen = await window.electronAPI.saveFileDialog(activeTab.path);
      if (chosen) saveToPath(chosen);
    } else {
      setSaveAsPath(activeTab.path);
      setShowSaveAsModal(true);
    }
  };

  const handleGoogleSignIn = async () => {
    if (!window.electronAPI) {
      setStatus('Sign-in works only in the desktop app');
      return;
    }
    try {
      const { code, redirectUri } = await window.electronAPI.googleSignIn();
      const response = await fetch(`${BACKEND_URL}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, redirectUri }),
      });
      const data = await response.json();
      if (data.success) {
        setUser(data.user);
        try {
          localStorage.setItem('user', JSON.stringify(data.user));
        } catch {
          // ignore
        }
      } else {
        setStatus('Sign-in failed: ' + data.error);
      }
    } catch (err) {
      setStatus('Sign-in failed: ' + err.message);
    }
  };

  const handleSignOut = () => {
    setUser(null);
    try {
      localStorage.removeItem('user');
    } catch {
      // ignore
    }
    setShowAccountMenu(false);
  };

  const submitSaveAs = () => {
    const newPath = saveAsPath.trim();
    setShowSaveAsModal(false);
    if (newPath) saveToPath(newPath);
  };

  // (Ctrl+B / Ctrl+J / Ctrl+Alt+B are handled in useLayout.js)
  const handleKeyDown = (e) => {
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (matchesShortcut(e, shortcuts.toggleTerminal)) {
      stop();
      togglePanel();
      return;
    }
    if (matchesShortcut(e, shortcuts.saveAs)) {
      stop();
      handleSaveAs();
      return;
    }
    if (matchesShortcut(e, shortcuts.save)) {
      stop();
      handleSave();
      return;
    }
    if (matchesShortcut(e, shortcuts.openFile)) {
      stop();
      handleOpenFile();
    }
  };

  // Listen on the whole window in the capture phase, so shortcuts also work when the cursor is
  // in the editor or the terminal. The ref always holds the latest handleKeyDown (no stale state).
  const keyHandlerRef = useRef(handleKeyDown);
  keyHandlerRef.current = handleKeyDown;
  useEffect(() => {
    const onKey = (e) => keyHandlerRef.current(e);
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const toggleMaximize = () => {
    setIsTerminalMaximized((prev) => !prev);
  };

  const terminalHeight = isTerminalMaximized ? '80vh' : `${layout.panelHeight}px`;

  return (
    <div
      style={{ display: 'flex', height: '100vh', width: '100%', background: '#12141c' }}
    >
      {!workspacePath ? (
        <WelcomeScreen onOpenFolder={handleOpenFolder} onOpenRecent={openFolderPath} onOpenFile={handleOpenFile} />
      ) : (
        <>
          {/* ---------- Primary side bar: activity bar + Explorer/Search ---------- */}
          <div style={{ display: 'flex', height: '100%' }}>
            <div style={{ width: '44px', flexShrink: 0, background: '#0e1016', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '8px', paddingBottom: '8px', height: '100%', boxSizing: 'border-box' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                <div
                  onClick={() => selectSidebar('explorer')}
                  title="Explorer (Ctrl+B to hide/show)"
                  style={{
                    fontSize: '20px', cursor: 'pointer', padding: '8px',
                    borderLeft: activeSidebar === 'explorer' && layout.showSidebar ? '2px solid #fff' : '2px solid transparent',
                    opacity: activeSidebar === 'explorer' && layout.showSidebar ? 1 : 0.6,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = 1; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = activeSidebar === 'explorer' && layout.showSidebar ? 1 : 0.6; }}
                >
                  📁
                </div>
                <div
                  onClick={() => selectSidebar('search')}
                  title="Search"
                  style={{
                    fontSize: '20px', cursor: 'pointer', padding: '8px',
                    borderLeft: activeSidebar === 'search' && layout.showSidebar ? '2px solid #fff' : '2px solid transparent',
                    opacity: activeSidebar === 'search' && layout.showSidebar ? 1 : 0.6,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = 1; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = activeSidebar === 'search' && layout.showSidebar ? 1 : 0.6; }}
                >
                  🔍
                </div>
              </div>

              <div style={{ marginTop: 'auto', position: 'relative' }}>
                <div
                  onClick={() => (user ? setShowAccountMenu((p) => !p) : handleGoogleSignIn())}
                  title={user ? user.name : 'Sign in with Google'}
                  style={{
                    width: '28px', height: '28px', borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', overflow: 'hidden',
                    background: user ? '#6d5ef5' : 'transparent',
                    border: user ? 'none' : '1px solid #888',
                  }}
                >
                  {user ? (
                    user.picture ? (
                      <img src={user.picture} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ color: '#fff', fontSize: '12px', fontWeight: 600 }}>
                        {user.name ? user.name.charAt(0).toUpperCase() : '?'}
                      </span>
                    )
                  ) : (
                    <span style={{ fontSize: '16px', color: '#ccc' }}>👤</span>
                  )}
                </div>

                {showAccountMenu && user && (
                  <>
                    <div onClick={() => setShowAccountMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
                    <div style={{
                      position: 'absolute', bottom: '0', left: '44px', marginLeft: '4px',
                      background: '#171a24', border: '1px solid #262a38', borderRadius: '4px',
                      zIndex: 100, minWidth: '200px', boxShadow: '0 4px 10px rgba(0,0,0,0.4)',
                    }}>
                      <div style={{ padding: '10px 14px', borderBottom: '1px solid #262a38' }}>
                        <div style={{ color: '#fff', fontSize: '13px', fontWeight: 600 }}>{user.name}</div>
                        <div style={{ color: '#999', fontSize: '12px' }}>{user.email}</div>
                      </div>
                      <div
                        onClick={handleSignOut}
                        style={{ padding: '8px 14px', color: '#ccc', cursor: 'pointer', fontSize: '13px' }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#262a38')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        Sign Out
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* kept mounted (just hidden) so expanded folders are remembered */}
            <div style={{
              display: layout.showSidebar ? 'block' : 'none',
              width: layout.sidebarWidth, flexShrink: 0, height: '100%', overflow: 'hidden',
            }}>
              {activeSidebar === 'explorer' ? (
                <FileExplorer key={workspacePath} onFileSelect={handleFileSelect} rootPath={workspacePath} />
              ) : (
                <SearchPanel onFileClick={handleFileSelect} rootPath={workspacePath} />
              )}
            </div>
            {layout.showSidebar && (
              <ResizeHandle direction="vertical" onResize={(d) => resizeBy('sidebarWidth', d)} />
            )}
          </div>

          {/* ---------- Main column: menu bar, tabs, editor, bottom panel ---------- */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: '#12141c' }}>

            <div style={{ background: '#12141c', padding: '8px', display: 'flex', alignItems: 'center', gap: '4px', position: 'relative', borderBottom: '1px solid #262a38' }}>
              <div style={{ position: 'relative' }}>
                <MenuItem label="File" active={showFileMenu} onClick={() => setShowFileMenu((prev) => !prev)} />
                {showFileMenu && (
                  <>
                    <div onClick={() => setShowFileMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, marginTop: '4px',
                      background: '#171a24', border: '1px solid #262a38', borderRadius: '4px',
                      zIndex: 100, minWidth: '220px', padding: '4px 0', boxShadow: '0 4px 10px rgba(0,0,0,0.4)'
                    }}>
                      <DropdownItem label="Open File..." shortcut="Ctrl+O" onClick={() => { setShowFileMenu(false); handleOpenFile(); }} />
                      <DropdownItem label="Open Folder..." shortcut="" onClick={() => { setShowFileMenu(false); handleOpenFolder(); }} />
                      <div style={{ borderTop: '1px solid #262a38', margin: '4px 0' }} />
                      <DropdownItem label="Save" shortcut="Ctrl+S" onClick={() => { setShowFileMenu(false); handleSave(); }} />
                      <DropdownItem label="Save As..." shortcut="Ctrl+Shift+S" onClick={() => { setShowFileMenu(false); handleSaveAs(); }} />
                      <div style={{ borderTop: '1px solid #262a38', margin: '4px 0' }} />
                      <DropdownItem label="Close Folder" shortcut="" onClick={() => { setShowFileMenu(false); handleCloseFolder(); }} />
                    </div>
                  </>
                )}
              </div>

              <MenuItem label="Settings" active={showSettings} onClick={() => setShowSettings(true)} />
              <MenuItem label="Terminal" active={isTerminalOpen && panelView === 'terminal'} onClick={togglePanel} />

              <h3 style={{ color: 'white', margin: '0 0 0 12px', fontSize: '15px' }}>AI-Powered IDE</h3>

              <MenuItem label="AI Chat" active={layout.showChat} onClick={() => toggleLayout('showChat')} />

              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ color: '#f66', fontSize: '13px' }}>{status}</span>
                <span
                  onClick={() => openPanel('problems')}
                  title="Show Problems"
                  style={{ display: 'flex', gap: '10px', color: '#ccc', fontSize: '12px', cursor: 'pointer' }}
                >
                  <span>⊗ {errorCount}</span>
                  <span>⚠ {warningCount}</span>
                </span>
                <LayoutToggles
                  layout={{ ...layout, showPanel: isTerminalOpen }}
                  toggle={(key) => (key === 'showPanel' ? togglePanel() : toggleLayout(key))}
                />
              </div>
            </div>

            {openFiles.length > 0 && (
              <div style={{ display: 'flex', background: '#171a24', borderBottom: '1px solid #262a38', overflowX: 'auto', flexShrink: 0 }}>
                {openFiles.map((f) => (
                  <div
                    key={f.path}
                    onClick={() => setActiveFile(f.path)}
                    title={f.path}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '8px 10px', cursor: 'pointer',
                      background: activeFile === f.path ? '#12141c' : 'transparent',
                      borderRight: '1px solid #262a38',
                      borderTop: activeFile === f.path ? '2px solid #6d5ef5' : '2px solid transparent',
                      color: activeFile === f.path ? '#fff' : '#999',
                      fontSize: '13px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {f.name}
                      {f.isDirty && (
                        <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#e2c08d', minWidth: '14px', textAlign: 'center' }}>
                          M
                        </span>
                      )}
                    </span>
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

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ flex: 1, minHeight: 0 }}>
                {activeTab ? (
                  <Editor
                    height="100%"
                    language={activeTab.language}
                    value={activeTab.content}
                    onChange={handleCodeChange}
                    beforeMount={defineIdeTheme}
                    onMount={(editor) => { editorRef.current = editor; }}
                    onValidate={setMarkers}
                    theme={editorTheme}
                    options={{
                      fontSize: fontSize,
                      wordWrap: editorPrefs.wordWrap ? 'on' : 'off',
                      tabSize: editorPrefs.tabSize,
                      minimap: { enabled: editorPrefs.minimap },
                      automaticLayout: true,
                    }}
                  />
                ) : (
                  <div style={{ color: '#666', padding: '20px', fontSize: '14px' }}>
                    No file open — select one from the Explorer, or use File → Open File / Open Folder.
                  </div>
                )}
              </div>

              {panelMounted && isTerminalOpen && !isTerminalMaximized && (
                <ResizeHandle direction="horizontal" onResize={(d) => resizeBy('panelHeight', -d)} />
              )}

              {panelMounted && (
                <div
                  style={{
                    display: isTerminalOpen ? 'block' : 'none',
                    height: terminalHeight,
                    borderTop: isTerminalMaximized ? '2px solid #262a38' : 'none',
                    width: '100%',
                    flexShrink: 0,
                  }}
                >
                  <BottomPanel
                    isMaximized={isTerminalMaximized}
                    onToggleMaximize={toggleMaximize}
                    activeView={panelView}
                    onViewChange={setPanelView}
                    problems={problems}
                    onProblemClick={handleProblemClick}
                    logs={logs}
                    onClearLogs={() => setLogs([])}
                    cwd={workspacePath}
                  />
                </div>
              )}
            </div>
          </div>

          {/* ---------- Secondary side bar: AI panel (full height, resizable) ---------- */}
          {layout.showChat && (
            <ResizeHandle direction="vertical" onResize={(d) => resizeBy('chatWidth', -d)} />
          )}
          {/* kept mounted (just hidden) so the conversation is not lost when toggled */}
          <div style={{
            display: layout.showChat ? 'flex' : 'none',
            flexDirection: 'column',
            width: layout.chatWidth, minWidth: 0, flexShrink: 0, height: '100%', overflow: 'hidden',
          }}>
            <ChatPanel
              model={selectedModel}
              onModelChange={setSelectedModel}
              onClose={() => toggleLayout('showChat')}
              openFiles={openFiles}
              activeFile={activeTab}
            />
          </div>
        </>
      )}

      {showSaveAsModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div style={{ background: '#171a24', padding: '20px', borderRadius: '8px', width: '400px', color: '#ccc' }}>
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
          onApply={({ theme, fontSize, wordWrap, tabSize, minimap, shortcuts: newShortcuts }) => {
            setEditorTheme(theme === 'dark' ? 'ide-dark' : 'vs');
            setFontSize(fontSize);
            setEditorPrefs({ wordWrap, tabSize, minimap });
            setShortcuts(newShortcuts);
            setShowSettings(false);
          }}
        />
      )}
    </div>
  );
}

export default App;