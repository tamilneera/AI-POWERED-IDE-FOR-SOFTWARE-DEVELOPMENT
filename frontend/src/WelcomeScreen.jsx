import { useState, useEffect } from 'react';

function getFolderName(p) {
  return p.split(/[\\/]/).filter(Boolean).pop() || p;
}

function getParentPath(p) {
  const parts = p.split(/[\\/]/).filter(Boolean);
  parts.pop();
  return parts.join(' \\ ');
}

export default function WelcomeScreen({ onOpenFolder, onOpenRecent, onOpenFile }) {
  const [recent, setRecent] = useState([]);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [showOnStartup, setShowOnStartup] = useState(true);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('recentFolders') || '[]');
      setRecent(stored);
      const pref = localStorage.getItem('showWelcomeOnStartup');
      setShowOnStartup(pref === null ? true : pref === 'true');
    } catch {
      setRecent([]);
    }
  }, []);

  const openRecent = (folderPath) => {
    onOpenRecent(folderPath);
  };

  const removeRecent = (e, folderPath) => {
    e.stopPropagation();
    const next = recent.filter(p => p !== folderPath);
    setRecent(next);
    try {
      localStorage.setItem('recentFolders', JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const toggleShowOnStartup = () => {
    const next = !showOnStartup;
    setShowOnStartup(next);
    try {
      localStorage.setItem('showWelcomeOnStartup', String(next));
    } catch {
      // ignore
    }
  };

  const visibleRecent = showAllRecent ? recent : recent.slice(0, 5);

  const linkStyle = {
    color: '#4fc1ff',
    fontSize: '13px',
    cursor: 'pointer',
    display: 'block',
    marginBottom: '10px',
  };
  const linkHoverOn = (e) => (e.currentTarget.style.textDecoration = 'underline');
  const linkHoverOff = (e) => (e.currentTarget.style.textDecoration = 'none');

  const sectionTitle = {
    color: '#ccc',
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '1px',
    marginBottom: '14px',
  };

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      background: '#1e1e1e', color: '#ccc', height: '100%', overflowY: 'auto',
    }}>
      <div style={{ maxWidth: '920px', width: '100%', margin: '0 auto', padding: '64px 48px 24px 48px', flex: 1 }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '56px' }}>
          <div style={{
  width: '52px', height: '52px', borderRadius: '10px',
  background: 'linear-gradient(135deg, #1e3a5f, #0e639c)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}}>
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
    <path
      d="M15.5 3.5c-4.5 0-8.2 3.7-8.2 8.2 0 4.5 3.7 8.2 8.2 8.2 1.8 0 3.5-.6 4.8-1.6-.5.1-1 .1-1.5.1-4.5 0-8.2-3.7-8.2-8.2 0-3 1.7-5.7 4.1-7.1-1-.4-2.1-.6-3.2-.6z"
      fill="#e8f0fe"
    />
    <path
      d="M4 8.5l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9.9-2z"
      fill="#4fc1ff"
    />
    <path
      d="M18.5 15l.6 1.3 1.3.6-1.3.6-.6 1.3-.6-1.3-1.3-.6 1.3-.6.6-1.3z"
      fill="#4fc1ff"
    />
  </svg>
</div>
          <div>
            <h1 style={{ color: 'white', fontSize: '26px', fontWeight: 400, margin: 0 }}>
              AI-Powered IDE
            </h1>
            <p style={{ color: '#888', margin: '2px 0 0 0', fontSize: '13px' }}>
              Editing evolved
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '80px' }}>

          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={sectionTitle}>Start</h3>
            <span onClick={onOpenFile} style={linkStyle} onMouseEnter={linkHoverOn} onMouseLeave={linkHoverOff}>
              📄 New File...
            </span>
            <span onClick={onOpenFile} style={linkStyle} onMouseEnter={linkHoverOn} onMouseLeave={linkHoverOff}>
              📂 Open File...  <span style={{ color: '#666' }}>Ctrl+O</span>
            </span>
            <span onClick={onOpenFolder} style={linkStyle} onMouseEnter={linkHoverOn} onMouseLeave={linkHoverOff}>
              📁 Open Folder...
            </span>
            <span style={{ ...linkStyle, color: '#666', cursor: 'default' }}>
              🔗 Clone Git Repository... <span style={{ fontSize: '11px' }}>(coming soon)</span>
            </span>

            <h3 style={{ ...sectionTitle, marginTop: '40px' }}>Recent</h3>
            {recent.length === 0 ? (
              <div style={{ color: '#666', fontSize: '13px' }}>No recent folders</div>
            ) : (
              <>
                {visibleRecent.map((folderPath) => (
                  <div
                    key={folderPath}
                    onClick={() => openRecent(folderPath)}
                    title={folderPath}
                    style={{
                      display: 'flex', alignItems: 'baseline', gap: '8px',
                      cursor: 'pointer', marginBottom: '10px', minWidth: 0,
                    }}
                  >
                    <span
                      style={{ color: '#4fc1ff', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      onMouseEnter={linkHoverOn}
                      onMouseLeave={linkHoverOff}
                    >
                      {getFolderName(folderPath)}
                    </span>
                    <span style={{ color: '#666', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 1 }}>
                      {getParentPath(folderPath)}
                    </span>
                    <span
                      onClick={(e) => removeRecent(e, folderPath)}
                      style={{ color: '#666', fontSize: '11px', marginLeft: 'auto', flexShrink: 0 }}
                      title="Remove from recent"
                    >
                      ✕
                    </span>
                  </div>
                ))}
                {recent.length > 5 && !showAllRecent && (
                  <span
                    onClick={() => setShowAllRecent(true)}
                    style={{ ...linkStyle, fontSize: '12px' }}
                    onMouseEnter={linkHoverOn}
                    onMouseLeave={linkHoverOff}
                  >
                    More...
                  </span>
                )}
              </>
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={sectionTitle}>Walkthroughs</h3>
            <div style={{
              border: '1px solid #333', borderRadius: '6px', padding: '16px', marginBottom: '24px',
            }}>
              <div style={{ color: '#fff', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
                Get Started with AI-Powered IDE
              </div>
              <div style={{ color: '#888', fontSize: '12px', marginBottom: '10px' }}>
                Open a folder, edit and save files, run the terminal, and search across your project.
              </div>
              <div style={{ height: '4px', background: '#333', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ width: '0%', height: '100%', background: '#0e639c' }} />
              </div>
            </div>

            <h3 style={sectionTitle}>Learn</h3>
            <span style={linkStyle} onMouseEnter={linkHoverOn} onMouseLeave={linkHoverOff}>
              ⌨️ Keyboard Shortcuts Reference
            </span>
            <span style={linkStyle} onMouseEnter={linkHoverOn} onMouseLeave={linkHoverOff}>
              📖 Documentation
            </span>
            <span style={linkStyle} onMouseEnter={linkHoverOn} onMouseLeave={linkHoverOff}>
              💬 Send Feedback
            </span>
          </div>
        </div>
      </div>

      <div style={{ padding: '16px 48px', borderTop: '1px solid #2a2a2a' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ccc', fontSize: '13px', cursor: 'pointer' }}>
          <input type="checkbox" checked={showOnStartup} onChange={toggleShowOnStartup} />
          Show welcome page on startup
        </label>
      </div>
    </div>
  );
}