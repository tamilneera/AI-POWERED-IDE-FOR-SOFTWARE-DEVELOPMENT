import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

// Point this at your backend's actual host/port.
const WS_URL = 'ws://10.231.208.94:5000/terminal';

export default function Terminal() {
  const containerRef = useRef(null);
  const xtermRef = useRef(null);
  const socketRef = useRef(null);
  const fitAddonRef = useRef(null);

  useEffect(() => {
    const term = new XTerm({
      cursorBlink: true,
      fontFamily: 'Menlo, Consolas, monospace',
      fontSize: 13,
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Safe fit: only fit if the container actually has a real size.
    // Prevents the "Cannot read properties of undefined (reading 'dimensions')"
    // crash that happens when fit() runs on a 0x0 or just-mounted container.
    const safeFit = () => {
      const el = containerRef.current;
      if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) return;
      try {
        fitAddon.fit();
      } catch (err) {
        // xterm can still throw in rare timing edge cases; never let it crash the app
        console.warn('Terminal fit skipped:', err);
      }
    };

    // Defer the first fit to the next animation frame so layout has settled
    requestAnimationFrame(safeFit);

    const socket = new WebSocket(WS_URL);
    socketRef.current = socket;

    socket.onopen = () => {
      term.writeln('\x1b[32m[Connected]\x1b[0m');
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'output') {
          term.write(msg.data);
        } else if (msg.type === 'exit') {
          term.writeln(`\r\n\x1b[33m[Process exited with code ${msg.code}]\x1b[0m`);
        }
      } catch (err) {
        console.error('Invalid message from server:', err);
      }
    };

    socket.onerror = () => {
      term.writeln('\r\n\x1b[31m[WebSocket error]\x1b[0m');
    };

    socket.onclose = () => {
      term.writeln('\r\n\x1b[31m[Disconnected]\x1b[0m');
    };

    let inputBuffer = '';
    term.onData((data) => {
      const code = data.charCodeAt(0);

      if (code === 13) {
        term.write('\r\n');
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'input', data: inputBuffer }));
        }
        inputBuffer = '';
      } else if (code === 127) {
        if (inputBuffer.length > 0) {
          inputBuffer = inputBuffer.slice(0, -1);
          term.write('\b \b');
        }
      } else {
        inputBuffer += data;
        term.write(data);
      }
    });

    // Re-fit whenever the container's actual size changes — this covers
    // window resizes AND the terminal panel being shown/hidden via toggle,
    // which a plain window "resize" listener would miss entirely.
    const resizeObserver = new ResizeObserver(() => {
      safeFit();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      socket.close();
      term.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', minHeight: '100px' }}
    />
  );
}