// One colour palette for the whole IDE (same colours as the AI panel)
export const C = {
    bg: '#12141c',        // editor / main background
    panel: '#171a24',     // sidebars, panels
    card: '#1d212d',      // pills, inputs, cards
    activity: '#0e1016',  // activity bar / title bar
    border: '#262a38',
    text: '#e6e8f0',
    muted: '#8a90a6',
    accent: '#6d5ef5',
    accentSoft: '#2a2650',
    hover: '#262b3b',
};

// Monaco editor theme — use: <Editor beforeMount={defineIdeTheme} theme="ide-dark" ... />
export function defineIdeTheme(monaco) {
    // Make sure JavaScript / TypeScript syntax errors get red underlines (and show in the Problems panel).
    // Python has no built-in checker in Monaco, so only the AI chat can find Python errors.
    try {
        const ts = monaco.languages.typescript || monaco.typescript;
        if (ts) {
            const diag = { noSyntaxValidation: false, noSemanticValidation: false, noSuggestionDiagnostics: false };
            ts.javascriptDefaults.setDiagnosticsOptions(diag);
            ts.typescriptDefaults.setDiagnosticsOptions(diag);
            const opts = {
                allowNonTsExtensions: true,
                allowJs: true,
                checkJs: true,
                target: ts.ScriptTarget.ESNext,
                module: ts.ModuleKind.ESNext,
                jsx: ts.JsxEmit.Preserve,
            };
            ts.javascriptDefaults.setCompilerOptions(opts);
            ts.typescriptDefaults.setCompilerOptions(opts);
        }
    } catch (err) {
        console.warn('Could not configure editor diagnostics:', err);
    }

    monaco.editor.defineTheme('ide-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
            'editor.background': C.bg,
            'editorGutter.background': C.bg,
            'editor.lineHighlightBackground': '#1a1d29',
            'editorLineNumber.foreground': '#4a4f63',
            'editorLineNumber.activeForeground': '#a99dff',
            'editor.selectionBackground': '#3a3480aa',
            'editorCursor.foreground': '#a99dff',
            'editorWidget.background': C.panel,
            'scrollbarSlider.background': '#2a2e3d99',
        },
    });
}

// xterm.js terminal theme — use: new Terminal({ theme: terminalTheme })
export const terminalTheme = {
    background: C.bg,
    foreground: C.text,
    cursor: '#a99dff',
    selectionBackground: '#3a3480aa',
};