import { useState } from 'react';
import { BACKEND_URL } from './config';

function getFileName(filePath) {
  return filePath.split(/[\\/]/).pop();
}

function SearchPanel({ onFileClick, rootPath }) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [results, setResults] = useState([]);
  const [totalMatches, setTotalMatches] = useState(0);
  const [status, setStatus] = useState('');
  const [collapsed, setCollapsed] = useState({});
  const [showReplace, setShowReplace] = useState(false);

  const runSearch = () => {
    if (!query) {
      setResults([]);
      setTotalMatches(0);
      return;
    }
    setStatus('Searching...');
    const params = new URLSearchParams({
      path: rootPath,
      query,
      regex: useRegex,
      caseSensitive,
    });
    fetch(`${BACKEND_URL}/api/search?${params}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          setStatus(data.error);
          setResults([]);
          setTotalMatches(0);
        } else {
          setResults(data.results || []);
          setTotalMatches(data.totalMatches || 0);
          setStatus('');
        }
      })
      .catch(err => setStatus('Search failed: ' + err.message));
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') runSearch();
  };

  const toggleCollapse = (file) => {
    setCollapsed(prev => ({ ...prev, [file]: !prev[file] }));
  };

  const handleReplaceAll = async () => {
    if (!query || !window.confirm(`Replace all ${totalMatches} matches across ${results.length} files?`)) return;
    setStatus('Replacing...');
    try {
      const response = await fetch(`${BACKEND_URL}/api/search/replace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: rootPath,
          query,
          replacement,
          regex: useRegex,
          caseSensitive,
        }),
      });
      const data = await response.json();
      if (data.success) {
        setStatus(`Replaced ${data.replacements} matches in ${data.filesChanged} files ✓`);
        runSearch();
      } else {
        setStatus('Replace failed: ' + data.error);
      }
    } catch (err) {
      setStatus('Replace failed: ' + err.message);
    }
  };

  return (
    <div style={{
      width: '260px', flexShrink: 0, background: '#252526', height: '100%',
      boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{ padding: '8px 8px 0 8px', flexShrink: 0 }}>
        <h4 style={{ color: 'white', margin: '4px 0 8px 0' }}>Search</h4>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
          <span
            onClick={() => setShowReplace(prev => !prev)}
            style={{ cursor: 'pointer', color: '#ccc', fontSize: '12px' }}
            title="Toggle Replace"
          >
            {showReplace ? '▾' : '▸'}
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search"
            style={{ flex: 1, padding: '4px', fontSize: '13px' }}
          />
        </div>

        {showReplace && (
          <input
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Replace"
            style={{ width: '100%', padding: '4px', fontSize: '13px', marginBottom: '4px', boxSizing: 'border-box' }}
          />
        )}

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px', fontSize: '11px' }}>
          <label style={{ color: useRegex ? '#4fc1ff' : '#999', cursor: 'pointer' }}>
            <input type="checkbox" checked={useRegex} onChange={(e) => setUseRegex(e.target.checked)} style={{ marginRight: '2px' }} />
            .*
          </label>
          <label style={{ color: caseSensitive ? '#4fc1ff' : '#999', cursor: 'pointer' }}>
            <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} style={{ marginRight: '2px' }} />
            Aa
          </label>
          <button onClick={runSearch} style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: '12px' }}>Search</button>
        </div>

        {showReplace && results.length > 0 && (
          <button onClick={handleReplaceAll} style={{ width: '100%', padding: '4px', fontSize: '12px', marginBottom: '8px' }}>
            Replace All ({totalMatches})
          </button>
        )}

        {status && <div style={{ color: '#f66', fontSize: '11px', marginBottom: '8px' }}>{status}</div>}
        {!status && totalMatches > 0 && (
          <div style={{ color: '#999', fontSize: '11px', marginBottom: '8px' }}>
            {totalMatches} results in {results.length} files
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '0 8px 8px 8px' }}>
        {results.map((r) => (
          <div key={r.file} style={{ marginBottom: '6px' }}>
            <div
              onClick={() => toggleCollapse(r.file)}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer',
                color: '#ccc', fontSize: '12px', padding: '2px 0',
              }}
              title={r.file}
            >
              <span>{collapsed[r.file] ? '▸' : '▾'}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {getFileName(r.file)}
              </span>
              <span style={{ color: '#888', fontSize: '11px' }}>{r.matches.length}</span>
            </div>
            {!collapsed[r.file] && r.matches.map((m, idx) => (
              <div
                key={idx}
                onClick={() => onFileClick(r.file)}
                style={{
                  paddingLeft: '18px', cursor: 'pointer', color: '#aaa', fontSize: '12px',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
                title={m.lineText.trim()}
              >
                <span style={{ color: '#666' }}>{m.line}:</span> {m.lineText.trim()}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default SearchPanel;