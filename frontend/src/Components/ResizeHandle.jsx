import { useState } from 'react';
import { C } from '../theme';

// Thin drag bar between two areas.
// direction="vertical"   -> a vertical bar you drag LEFT/RIGHT (changes widths)
// direction="horizontal" -> a horizontal bar you drag UP/DOWN (changes heights)
// onResize(delta) is called continuously with how many pixels the mouse moved since the last call.
function ResizeHandle({ direction = 'vertical', onResize }) {
    const [hot, setHot] = useState(false);
    const isVertical = direction === 'vertical';

    const onPointerDown = (e) => {
        e.preventDefault();
        let last = isVertical ? e.clientX : e.clientY;
        setHot(true);
        document.body.style.userSelect = 'none';
        document.body.style.cursor = isVertical ? 'col-resize' : 'row-resize';

        const move = (ev) => {
            const pos = isVertical ? ev.clientX : ev.clientY;
            onResize(pos - last);
            last = pos;
        };
        const up = () => {
            setHot(false);
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    };

    return (
        <div
            onPointerDown={onPointerDown}
            onMouseEnter={() => setHot(true)}
            onMouseLeave={(e) => { if (e.buttons === 0) setHot(false); }}
            style={{
                flexShrink: 0,
                width: isVertical ? '5px' : '100%',
                height: isVertical ? '100%' : '5px',
                cursor: isVertical ? 'col-resize' : 'row-resize',
                background: hot ? C.accent : C.border,
                opacity: hot ? 0.9 : 0.6,
                transition: 'background 0.1s',
                zIndex: 5,
            }}
        />
    );
}

export default ResizeHandle;