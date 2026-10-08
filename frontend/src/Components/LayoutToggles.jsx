import { C } from '../theme';

// The three VS Code style layout buttons: left side bar, bottom panel, right side bar
function Icon({ part, on }) {
    const fill = on ? 'currentColor' : 'none';
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
            {part === 'left' && <rect x="1.5" y="2.5" width="4.5" height="11" fill={fill} />}
            {part === 'bottom' && <rect x="1.5" y="9.5" width="13" height="4" fill={fill} />}
            {part === 'right' && <rect x="10" y="2.5" width="4.5" height="11" fill={fill} />}
        </svg>
    );
}

function Btn({ part, on, onClick, title }) {
    return (
        <span
            onClick={onClick}
            title={title}
            style={{
                width: '28px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: '5px', cursor: 'pointer', color: on ? '#a99dff' : C.muted,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = C.hover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
            <Icon part={part} on={on} />
        </span>
    );
}

function LayoutToggles({ layout, toggle }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
            <Btn part="left" on={layout.showSidebar} onClick={() => toggle('showSidebar')} title="Toggle Primary Side Bar (Ctrl+B)" />
            <Btn part="bottom" on={layout.showPanel} onClick={() => toggle('showPanel')} title="Toggle Panel (Ctrl+J)" />
            <Btn part="right" on={layout.showChat} onClick={() => toggle('showChat')} title="Toggle Secondary Side Bar / AI (Ctrl+Alt+B)" />
        </div>
    );
}

export default LayoutToggles;