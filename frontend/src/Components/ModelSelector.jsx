import { useState, useEffect } from 'react';
import { BACKEND_URL } from '../config';

function ModelSelector({ onSelect, selected }) {
  const [models, setModels] = useState([]);
  const [status, setStatus] = useState('Loading...');

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/ai/models`)
      .then(res => res.json())
      .then(data => {
        setModels(data.models || []);
        setStatus(data.models?.length ? '' : 'No models — is Ollama running?');
        if (data.models?.length && !selected) {
          onSelect(data.models[0]);
        }
      })
      .catch(err => setStatus('Failed: ' + err.message));
  }, []);

  const handleChange = (e) => {
    const picked = models.find(m => `${m.provider}:${m.model}` === e.target.value);
    if (picked) onSelect(picked);
  };

  if (status && models.length === 0) {
    return <span style={{ fontSize: '11px', color: '#f66' }}>{status}</span>;
  }

  return (
    <select
      value={selected ? `${selected.provider}:${selected.model}` : ''}
      onChange={handleChange}
      style={{
        fontSize: '11px', padding: '4px 8px', background: '#2a2a2a', color: '#ccc',
        border: '1px solid #3a3a3a', borderRadius: '14px', cursor: 'pointer',
      }}
      title="Choose AI model"
    >
      {models.map(m => (
        <option key={`${m.provider}:${m.model}`} value={`${m.provider}:${m.model}`}>
          {m.label}
        </option>
      ))}
    </select>
  );
}

export default ModelSelector;