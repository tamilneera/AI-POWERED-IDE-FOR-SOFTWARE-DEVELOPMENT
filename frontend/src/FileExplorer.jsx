import { useState, useEffect } from 'react';

const BACKEND_URL = 'http://10.231.208.94:5000'; // same IP as before
const PROJECT_PATH = 'C:/Users/ANAND/Projects/AI-POWERED-IDE-FOR-SOFTWARE-DEVELOPMENT';

function TreeItem({ node, onFileClick, depth = 0 }) {
  const [expanded, setExpanded] = useState(false);

  if (node.isDirectory) {
    return (
      <div>
        <div
          style={{ paddingLeft: depth * 16, cursor: 'pointer', color: '#ccc' }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '📂' : '📁'} {node.name}
        </div>
        {expanded && node.children && node.children.map((child) => (
          <TreeItem key={child.path} node={child} onFileClick={onFileClick} depth={depth + 1} />
        ))}
      </div>
    );
  }

  return (
    <div
      style={{ paddingLeft: depth * 16, cursor: 'pointer', color: '#aaa' }}
      onClick={() => onFileClick(node.path)}
    >
      📄 {node.name}
    </div>
  );
}

function FileExplorer({ onFileSelect }) {
  const [tree, setTree] = useState([]);
  const [status, setStatus] = useState('Loading...');

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/workspace/tree?path=${encodeURIComponent(PROJECT_PATH)}`)
      .then(res => res.json())
      .then(data => {
        setTree(data);
        setStatus('');
      })
      .catch(err => setStatus('Failed to load: ' + err.message));
  }, []);

  return (
    <div style={{ width: '250px', background: '#252526', height: '100vh', overflowY: 'auto', padding: '8px' }}>
      <h4 style={{ color: 'white', margin: '4px 0' }}>Explorer</h4>
      {status && <div style={{ color: '#f66' }}>{status}</div>}
      {tree.map((node) => (
        <TreeItem key={node.path} node={node} onFileClick={onFileSelect} />
      ))}
    </div>
  );
}

export default FileExplorer;