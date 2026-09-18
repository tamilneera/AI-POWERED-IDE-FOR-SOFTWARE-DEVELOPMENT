import { useState, useEffect } from 'react';

const BACKEND_URL = 'http://10.231.208.94:5000'; // same IP as before
const PROJECT_PATH = 'C:/Users/ANAND/Projects/AI-POWERED-IDE-FOR-SOFTWARE-DEVELOPMENT';

function TreeItem({ node, onFileClick, onRefresh, depth = 0 }) {
  const [expanded, setExpanded] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const handleDelete = async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete ${node.name}?`)) return;
    await fetch(`${BACKEND_URL}/api/files?path=${encodeURIComponent(node.path)}`, {
      method: 'DELETE'
    });
    onRefresh();
  };

  const startRename = (e) => {
    e.stopPropagation();
    setInputValue(node.name);
    setRenaming(true);
  };

  const submitRename = async () => {
    if (!inputValue || inputValue === node.name) {
      setRenaming(false);
      return;
    }
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
    if (!inputValue) {
      setCreating(false);
      return;
    }
    const newPath = node.path + '\\' + inputValue;
    await fetch(`${BACKEND_URL}/api/files/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: newPath, content: '' })
    });
    setCreating(false);
    onRefresh();
  };

  if (node.isDirectory) {
    return (
      <div>
        <div
          style={{ paddingLeft: depth * 16, cursor: 'pointer', color: '#ccc', display: 'flex', alignItems: 'center', gap: '4px' }}
          onClick={() => setExpanded(!expanded)}
        >
          {renaming ? (
            <input
              autoFocus
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.key === 'Enter' && submitRename()}
              onBlur={submitRename}
              style={{ flex: 1, fontSize: '13px' }}
            />
          ) : (
            <span style={{ flex: 1 }}>{expanded ? '📂' : '📁'} {node.name}</span>
          )}
          <span style={{ fontSize: '11px', cursor: 'pointer' }} onClick={startCreate} title="New file">➕</span>
          <span style={{ fontSize: '11px', cursor: 'pointer' }} onClick={startRename} title="Rename">✏️</span>
          <span style={{ fontSize: '11px', cursor: 'pointer' }} onClick={handleDelete} title="Delete">🗑️</span>
        </div>
        {creating && (
          <div style={{ paddingLeft: (depth + 1) * 16 }}>
            <input
              autoFocus
              placeholder="filename.ext"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitCreate()}
              onBlur={submitCreate}
              style={{ fontSize: '13px' }}
            />
          </div>
        )}
        {expanded && node.children && node.children.map((child) => (
          <TreeItem key={child.path} node={child} onFileClick={onFileClick} onRefresh={onRefresh} depth={depth + 1} />
        ))}
      </div>
    );
  }

  return (
    <div style={{ paddingLeft: depth * 16, cursor: 'pointer', color: '#aaa', display: 'flex', alignItems: 'center', gap: '4px' }}>
      {renaming ? (
        <input
          autoFocus
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitRename()}
          onBlur={submitRename}
          style={{ flex: 1, fontSize: '13px' }}
        />
      ) : (
        <span style={{ flex: 1 }} onClick={() => onFileClick(node.path)}>📄 {node.name}</span>
      )}
      <span style={{ fontSize: '11px', cursor: 'pointer' }} onClick={startRename} title="Rename">✏️</span>
      <span style={{ fontSize: '11px', cursor: 'pointer' }} onClick={handleDelete} title="Delete">🗑️</span>
    </div>
  );
}

function FileExplorer({ onFileSelect }) {
  const [tree, setTree] = useState([]);
  const [status, setStatus] = useState('Loading...');

  const loadTree = () => {
    fetch(`${BACKEND_URL}/api/workspace/tree?path=${encodeURIComponent(PROJECT_PATH)}`)
      .then(res => res.json())
      .then(data => {
        setTree(data);
        setStatus('');
      })
      .catch(err => setStatus('Failed to load: ' + err.message));
  };

  useEffect(() => {
    loadTree();
  }, []);

  return (
    <div style={{ width: '260px', background: '#252526', height: '100vh', overflowY: 'auto', padding: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ color: 'white', margin: '4px 0' }}>Explorer</h4>
        <span style={{ fontSize: '14px', cursor: 'pointer' }} onClick={loadTree} title="Refresh">🔄</span>
      </div>
      {status && <div style={{ color: '#f66' }}>{status}</div>}
      {tree.map((node) => (
        <TreeItem key={node.path} node={node} onFileClick={onFileSelect} onRefresh={loadTree} />
      ))}
    </div>
  );
}

export default FileExplorer;