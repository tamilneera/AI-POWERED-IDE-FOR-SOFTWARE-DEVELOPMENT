import { useState, useEffect, useRef } from 'react';

const BACKEND_URL = 'http://10.231.208.94:5000';
const PROJECT_PATH = 'C:/Users/ANAND/Projects/AI-POWERED-IDE-FOR-SOFTWARE-DEVELOPMENT';

function TreeItem({ node, onFileClick, onRefresh, depth, dragState, onPointerDownItem, hoverPath }) {
  const [expanded, setExpanded] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const handleDelete = async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete ${node.name}?`)) return;
    await fetch(`${BACKEND_URL}/api/files?path=${encodeURIComponent(node.path)}`, { method: 'DELETE' });
    onRefresh();
  };

  const startRename = (e) => {
    e.stopPropagation();
    setInputValue(node.name);
    setRenaming(true);
  };

  const submitRename = async () => {
    if (!inputValue || inputValue === node.name) { setRenaming(false); return; }
    const newPath = node.path.substring(0, node.path.lastIndexOf('\\') + 1) + inputValue;
    await fetch(`${BACKEND_URL}/api/files/rename`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath: node.path, newPath })
    });
    setRenaming(false);
    onRefresh();
  };

  const startCreate = (e) => {
    e.stopPropagation();
    setInputValue('');
    setCreating(true);
    setExpanded(true);
  };

  const submitCreate = async () => {
    if (!inputValue) { setCreating(false); return; }
    const newPath = node.path + '\\' + inputValue;
    await fetch(`${BACKEND_URL}/api/files/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: newPath, content: '' })
    });
    setCreating(false);
    onRefresh();
  };

  const isDragging = dragState.path === node.path;
  const isHoverTarget = hoverPath === node.path && node.isDirectory && dragState.path && dragState.path !== node.path;

  const rowStyle = {
    paddingLeft: depth * 16, cursor: 'grab', color: '#ccc',
    display: 'flex', alignItems: 'center', gap: '4px',
    background: isHoverTarget ? '#264f78' : 'transparent',
    borderTop: isHoverTarget ? '1px solid #4fc1ff' : '1px solid transparent',
    opacity: isDragging ? 0.4 : 1,
    userSelect: 'none'
  };

  if (node.isDirectory) {
    return (
      <div>
        <div
          data-path={node.path}
          data-isdir="true"
          style={rowStyle}
          onPointerDown={(e) => onPointerDownItem(e, node)}
          onClick={() => !dragState.active && setExpanded(!expanded)}
        >
          {renaming ? (
            <input autoFocus value={inputValue} onChange={(e) => setInputValue(e.target.value)}
              onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Enter' && submitRename()}
              onBlur={submitRename} style={{ flex: 1, fontSize: '13px' }} />
          ) : (
            <span style={{ flex: 1 }}>{expanded ? '📂' : '📁'} {node.name}</span>
          )}
          <span style={{ fontSize: '11px', cursor: 'pointer' }} onClick={startCreate} title="New file">➕</span>
          <span style={{ fontSize: '11px', cursor: 'pointer' }} onClick={startRename} title="Rename">✏️</span>
          <span style={{ fontSize: '11px', cursor: 'pointer' }} onClick={handleDelete} title="Delete">🗑️</span>
        </div>
        {creating && (
          <div style={{ paddingLeft: (depth + 1) * 16 }}>
            <input autoFocus placeholder="filename.ext" value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitCreate()}
              onBlur={submitCreate} style={{ fontSize: '13px' }} />
          </div>
        )}
        {expanded && node.children && node.children.map((child) => (
          <TreeItem key={child.path} node={child} onFileClick={onFileClick} onRefresh={onRefresh}
            depth={depth + 1} dragState={dragState} onPointerDownItem={onPointerDownItem} hoverPath={hoverPath} />
        ))}
      </div>
    );
  }

  return (
    <div data-path={node.path} data-isdir="false" style={rowStyle} onPointerDown={(e) => onPointerDownItem(e, node)}>
      {renaming ? (
        <input autoFocus value={inputValue} onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitRename()}
          onBlur={submitRename} style={{ flex: 1, fontSize: '13px' }} />
      ) : (
        <span style={{ flex: 1 }} onClick={() => !dragState.active && onFileClick(node.path)}>📄 {node.name}</span>
      )}
      <span style={{ fontSize: '11px', cursor: 'pointer' }} onClick={startRename} title="Rename">✏️</span>
      <span style={{ fontSize: '11px', cursor: 'pointer' }} onClick={handleDelete} title="Delete">🗑️</span>
    </div>
  );
}

function FileExplorer({ onFileSelect }) {
  const [tree, setTree] = useState([]);
  const [status, setStatus] = useState('Loading...');
  const [hoverPath, setHoverPathState] = useState(null);
  const hoverPathRef = useRef(null);
  const dragState = useRef({ active: false, path: null, name: null, startX: 0, startY: 0 });
  const [, forceRender] = useState(0);

  const setHoverPath = (val) => {
    hoverPathRef.current = val;
    setHoverPathState(val);
  };

  const loadTree = () => {
    fetch(`${BACKEND_URL}/api/workspace/tree?path=${encodeURIComponent(PROJECT_PATH)}`)
      .then(res => res.json())
      .then(data => { setTree(data); setStatus(''); })
      .catch(err => setStatus('Failed to load: ' + err.message));
  };

  useEffect(() => { loadTree(); }, []);

  useEffect(() => {
    const eventSource = new EventSource(
      `${BACKEND_URL}/api/workspace/watch?path=${encodeURIComponent(PROJECT_PATH)}`
    );
    eventSource.onmessage = () => { loadTree(); };
    return () => eventSource.close();
  }, []);

  const onPointerDownItem = (e, node) => {
    e.stopPropagation();
    dragState.current = { active: false, path: node.path, name: node.name, startX: e.clientX, startY: e.clientY };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const onPointerMove = (e) => {
    const d = dragState.current;
    if (!d.path) return;
    const dx = Math.abs(e.clientX - d.startX);
    const dy = Math.abs(e.clientY - d.startY);
    if (!d.active && (dx > 5 || dy > 5)) {
      d.active = true;
      forceRender(n => n + 1);
    }
    if (d.active) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const target = el && el.closest('[data-isdir="true"]');
      const targetPath = target ? target.getAttribute('data-path') : null;
      setHoverPath(targetPath && targetPath !== d.path ? targetPath : null);
    }
  };

  const onPointerUp = async (e) => {
    const d = dragState.current;
    const currentHoverPath = hoverPathRef.current;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);

    if (d.active && currentHoverPath) {
      const newPath = currentHoverPath + '\\' + d.name;
      if (newPath !== d.path) {
        await fetch(`${BACKEND_URL}/api/files/rename`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oldPath: d.path, newPath })
        });
        loadTree();
      }
    }
    dragState.current = { active: false, path: null, name: null, startX: 0, startY: 0 };
    setHoverPath(null);
    forceRender(n => n + 1);
  };

  return (
    <div style={{ width: '260px', background: '#252526', height: '100vh', overflowY: 'auto', padding: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ color: 'white', margin: '4px 0' }}>Explorer</h4>
        <span style={{ fontSize: '14px', cursor: 'pointer' }} onClick={loadTree} title="Refresh">🔄</span>
      </div>
      {status && <div style={{ color: '#f66' }}>{status}</div>}
      {tree.map((node) => (
        <TreeItem key={node.path} node={node} onFileClick={onFileSelect} onRefresh={loadTree}
          depth={0} dragState={dragState.current} onPointerDownItem={onPointerDownItem} hoverPath={hoverPath} />
      ))}
    </div>
  );
}

export default FileExplorer;