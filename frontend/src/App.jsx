import Editor from '@monaco-editor/react';

function App() {
  return (
    <div style={{ height: '100vh' }}>
      <h3 style={{ color: 'white', background: '#1e1e1e', margin: 0, padding: '8px' }}>
        AI-Powered IDE
      </h3>
      <Editor
        height="90vh"
        defaultLanguage="javascript"
        defaultValue="// Start coding here..."
        theme="vs-dark"
      />
    </div>
  );
}

export default App;