import { useState, useEffect, useCallback, useRef } from 'react';

const KEY = 'ide-layout-v1';

const DEFAULTS = {
    showSidebar: true,   // primary side bar (Explorer)
    showChat: false,     // secondary side bar (AI panel) — closed until the user opens it
    sidebarWidth: 260,
    chatWidth: 380,
    panelHeight: 240,
};

const LIMITS = {
    sidebarWidth: [160, 500],
    chatWidth: [280, 700],
    panelHeight: [100, 600],
};

function load() {
    try {
        return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    } catch {
        return DEFAULTS;
    }
}

// onTogglePanel: called for Ctrl+J (the bottom panel's open/closed state lives in App.jsx)
export function useLayout({ onTogglePanel } = {}) {
    const [layout, setLayout] = useState(load);

    // always points at the latest callback, so the key listener never goes stale
    const panelRef = useRef(onTogglePanel);
    panelRef.current = onTogglePanel;

    // remember what the user chose, like VS Code
    useEffect(() => {
        try { localStorage.setItem(KEY, JSON.stringify(layout)); } catch { }
    }, [layout]);

    const toggle = useCallback((key) => {
        setLayout(l => ({ ...l, [key]: !l[key] }));
    }, []);

    // resizeBy adds a delta to the CURRENT value (functional update, so no stale values while dragging)
    const resizeBy = useCallback((key, delta) => {
        const [min, max] = LIMITS[key];
        setLayout(l => ({ ...l, [key]: Math.min(max, Math.max(min, l[key] + delta)) }));
    }, []);

    const reset = useCallback(() => setLayout(DEFAULTS), []);

    // VS Code shortcuts: Ctrl+B sidebar, Ctrl+Alt+B AI panel, Ctrl+J bottom panel.
    // Runs in the CAPTURE phase on window, so it fires first — even when the cursor is inside the
    // Monaco editor or the terminal (both swallow keys). e.code is used so it works on any keyboard layout.
    useEffect(() => {
        const onKey = (e) => {
            if (!(e.ctrlKey || e.metaKey) || e.shiftKey) return;
            let handled = true;
            if (e.code === 'KeyB' && e.altKey) {
                if (!e.repeat) toggle('showChat');
            } else if (e.code === 'KeyB') {
                if (!e.repeat) toggle('showSidebar');
            } else if (e.code === 'KeyJ' && !e.altKey) {
                if (!e.repeat && panelRef.current) panelRef.current();
            } else {
                handled = false;
            }
            if (handled) {
                e.preventDefault();
                e.stopPropagation();
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [toggle]);

    return { layout, toggle, resizeBy, reset };
}