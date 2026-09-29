import { useState, useEffect, useRef } from 'react';
import { BACKEND_URL } from './config';

function TreeItem({
  node, onFileClick, onRefresh, depth, dragState, onPointerDownItem,
  hoverPath, onContextMenu, pendingAction, onActionHandled, selectedPath,
}) {
  const [expanded, setExpanded] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    if (!pendingAction || pendingAction.path !== node.path) return;
    if (pendingAction.type === 'rename') {
      setInputValue(node.name);
      setRenaming(true);
    } else if (pendingAction.type === 'create' && node.isDirectory) {
      setInputValue('');
      setCreating(true);
      setExpanded(true);
    }
    onActionHandled();
  }, [pendingAction]);

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
  const isSelected = selectedPath === node.path;

  const rowStyle = {
    paddingLeft: 8 + depth * 14,
    paddingTop: 2,
    paddingBottom: 2,
    cursor: 'pointer',
    color: '#ccc',
    fontSize: '13px',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    background: isHoverTarget ? '#264f78' : isSelected ? '#37373d' : isHovered ? '#2a2d2e' : 'transparent',
    borderTop: isHoverTarget ? '1px solid #4fc1ff' : '1px solid transparent',
    opacity: isDragging ? 0.4 : 1,
    userSelect: 'none',
  };

  const renameInput = (
    <input
      autoFocus
      value={inputValue}
      onChange={(e) => setInputValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') submitRename();
        if (e.key === 'Escape') setRenaming(false);
      }}
      onBlur={submitRename}
      style={{ flex: 1, fontSize: '13px', minWidth: 0 }}
    />
  );

  const nameStyle = { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

  if (node.isDirectory) {
    return (
      <div>
        <div
          data-path={node.path}
          data-isdir="true"
          style={rowStyle}
          onPointerDown={(e) => onPointerDownItem(e, node)}
          onClick={() => !dragState.active && setExpanded(!expanded)}
          onContextMenu={(e) => onContextMenu(e, node)}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <span style={{ width: '12px', fontSize: '10px', color: '#c5c5c5' }}>{expanded ? '▾' : '▸'}</span>
          {renaming ? renameInput : <span style={nameStyle}>{node.name}</span>}
        </div>

        {creating && (
          <div style={{ paddingLeft: 8 + (depth + 1) * 14 + 16 }}>
            <input
              autoFocus
              placeholder="filename.ext"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitCreate();
                if (e.key === 'Escape') setCreating(false);
              }}
              onBlur={submitCreate}
              style={{ fontSize: '13px' }}
            />
          </div>
        )}

        {expanded && node.children && node.children.map((child) => (
          <TreeItem
            key={child.path} node={child} onFileClick={onFileClick} onRefresh={onRefresh}
            depth={depth + 1} dragState={dragState} onPointerDownItem={onPointerDownItem}
            hoverPath={hoverPath} onContextMenu={onContextMenu}
            pendingAction={pendingAction} onActionHandled={onActionHandled} selectedPath={selectedPath}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      data-path={node.path}
      data-isdir="false"
      style={rowStyle}
      onPointerDown={(e) => onPointerDownItem(e, node)}
      onClick={() => !dragState.active && onFileClick(node.path)}
      onContextMenu={(e) => onContextMenu(e, node)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <span style={{ width: '12px' }} />
      {renaming ? renameInput : <span style={nameStyle}>{node.name}</span>}
    </div>
  );
}

function FileExplorer({ onFileSelect, rootPath }) {
  const [tree, setTree] = useState([]);
  const [status, setStatus] = useState('Loading...');
  const [loaded, setLoaded] = useState(false);
  const [hoverPath, setHoverPathState] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [selectedPath, setSelectedPath] = useState(null);
  const hoverPathRef = useRef(null);
  const dragState = useRef({ active: false, path: null, name: null, startX: 0, startY: 0 });
  const [, forceRender] = useState(0);

  const folderName = rootPath.split(/[\\/]/).filter(Boolean).pop() || rootPath;

  const setHoverPath = (val) => {
    hoverPathRef.current = val;
    setHoverPathState(val);
  };

  const loadTree = () => {
    fetch(`${BACKEND_URL}/api/workspace/tree?path=${encodeURIComponent(rootPath)}`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setTree(data);
          setStatus('');
        } else {
          setTree([]);
          setStatus(
            (data && data.error ? data.error : 'Could not read this folder') +
            ' — the backend must be able to see this path on its own computer.'
          );
        }
        setLoaded(true);
      })
      .catch(err => {
        setStatus('Failed to load: ' + err.message);
        setLoaded(true);
      });
  };

  useEffect(() => { loadTree(); }, [rootPath]);

  useEffect(() => {
    const eventSource = new EventSource(
      `${BACKEND_URL}/api/workspace/watch?path=${encodeURIComponent(rootPath)}`
    );
    eventSource.onmessage = () => { loadTree(); };
    return () => eventSource.close();
  }, [rootPath]);

  const handleFileClick = (path) => {
    setSelectedPath(path);
    onFileSelect(path);
  };

  const handleContextMenu = (e, node) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedPath(node.path);
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  };

  const closeMenu = () => setContextMenu(null);

  const menuRename = () => {
    setPendingAction({ path: contextMenu.node.path, type: 'rename' });
    closeMenu();
  };

  const menuNewFile = () => {
    setPendingAction({ path: contextMenu.node.path, type: 'create' });
    closeMenu();
  };

  const menuDelete = async () => {
    const node = contextMenu.node;
    closeMenu();
    if (!window.confirm(`Delete ${node.name}?`)) return;
    await fetch(`${BACKEND_URL}/api/files?path=${encodeURIComponent(node.path)}`, { method: 'DELETE' });
    loadTree();
  };

  const onPointerDownItem = (e, node) => {
    if (e.button !== 0) return;
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

  const onPointerUp = async () => {
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

  const menuItemStyle = { padding: '6px 24px', color: '#ccc', cursor: 'pointer', fontSize: '13px' };
  const hoverOn = (e) => (e.currentTarget.style.background = '#094771');
  const hoverOff = (e) => (e.currentTarget.style.background = 'transparent');

  return (
    <div
      style={{
        width: '220px',
        flexShrink: 0,
        background: '#252526',
        height: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 8px 4px 12px', flexShrink: 0 }}>
        <span style={{ color: '#bbb', fontSize: '11px', letterSpacing: '1px', fontWeight: 600 }}>EXPLORER</span>
        <span style={{ fontSize: '13px', cursor: 'pointer', color: '#bbb' }} onClick={loadTree} title="Refresh">⟳</span>
      </div>

      <div
        title={rootPath}
        style={{ padding: '2px 12px 6px 12px', color: '#e7e7e7', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        ▾ {folderName}
      </div>

      {status && <div style={{ color: '#f66', padding: '0 12px 8px 12px', fontSize: '12px' }}>{status}</div>}
      {loaded && !status && tree.length === 0 && (
        <div style={{ color: '#888', padding: '0 12px', fontSize: '12px' }}>This folder is empty.</div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingBottom: '8px' }}>
        {tree.map((node) => (
          <TreeItem
            key={node.path} node={node} onFileClick={handleFileClick} onRefresh={loadTree}
            depth={0} dragState={dragState.current} onPointerDownItem={onPointerDownItem}
            hoverPath={hoverPath} onContextMenu={handleContextMenu}
            pendingAction={pendingAction} onActionHandled={() => setPendingAction(null)}
            selectedPath={selectedPath}
          />
        ))}
      </div>

      {contextMenu && (
        <>
          <div
            onClick={closeMenu}
            onContextMenu={(e) => { e.preventDefault(); closeMenu(); }}
            style={{ position: 'fixed', inset: 0, zIndex: 999 }}
          />
          <div style={{
            position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 1000,
            background: '#252526', border: '1px solid #454545', borderRadius: '4px',
            minWidth: '160px', padding: '4px 0', boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          }}>
            {contextMenu.node.isDirectory && (
              <div style={menuItemStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff} onClick={menuNewFile}>New File</div>
            )}
            <div style={menuItemStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff} onClick={menuRename}>Rename</div>
            <div style={menuItemStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff} onClick={menuDelete}>Delete</div>
          </div>
        </>
      )}
    </div>
  );
}

export default FileExplorer;