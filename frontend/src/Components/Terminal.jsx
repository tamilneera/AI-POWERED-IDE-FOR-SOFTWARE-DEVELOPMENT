import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { WS_URL } from '../config';
import { terminalTheme } from '../theme';

export default function Terminal({ cwd = '' }) {
  const containerRef = useRef(null);
  const xtermRef = useRef(null);
  const socketRef = useRef(null);
  const fitAddonRef = useRef(null);

  useEffect(() => {
    const term = new XTerm({
      cursorBlink: true,
      fontFamily: 'Menlo, Consolas, monospace',
      fontSize: 13,
      theme: terminalTheme,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Only fit when the container has a real size, to avoid xterm crashing on a 0x0 container
    const safeFit = () => {
      const el = containerRef.current;
      if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) return;
      try {
        fitAddon.fit();
      } catch (err) {
        console.warn('Terminal fit skipped:', err);
      }
    };

    requestAnimationFrame(safeFit);

    // tell the backend which folder the shell should start in (the folder open in the IDE)
    const url = cwd ? `${WS_URL}${WS_URL.includes('?') ? '&' : '?'}cwd=${encodeURIComponent(cwd)}` : WS_URL;
    const socket = new WebSocket(url);
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

    // ---- typing, pasting and copying ----
    let inputBuffer = '';

    // Handles typed OR pasted text. A pasted block may contain several lines: every full line is sent as a command.
    const handleText = (text) => {
      const clean = text.replace(/\r\n/g, '\r').replace(/\n/g, '\r');
      for (const ch of clean) {
        const code = ch.charCodeAt(0);
        if (code === 13) {
          term.write('\r\n');
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'input', data: inputBuffer }));
          }
          inputBuffer = '';
        } else if (code === 127 || code === 8) {
          if (inputBuffer.length > 0) {
            inputBuffer = inputBuffer.slice(0, -1);
            term.write('\b \b');
          }
        } else if (code === 3) {
          // Ctrl+C with nothing selected: cancel the line being typed
          term.write('^C\r\n');
          inputBuffer = '';
        } else if (code >= 32) {
          inputBuffer += ch;
          term.write(ch);
        }
      }
    };

    term.onData((data) => {
      if (data.startsWith('\x1b')) return; // arrow keys etc. are not supported by this simple terminal
      handleText(data);
    });

    const copySelection = () => {
      const text = term.getSelection();
      if (!text) return false;
      try { navigator.clipboard.writeText(text); } catch { /* clipboard blocked */ }
      return true;
    };

    const pasteFromClipboard = async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) handleText(text);
      } catch (err) {
        console.warn('Paste blocked:', err);
        term.writeln('\r\n\x1b[33m[Paste blocked: allow clipboard access]\x1b[0m');
      }
    };

    // Ctrl+C copies when text is selected, Ctrl+V and Ctrl+Shift+V paste, Ctrl+Shift+C always copies
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (ctrl && key === 'c' && (e.shiftKey || term.hasSelection())) {
        copySelection();
        return false;
      }
      if (ctrl && key === 'v') {
        e.preventDefault();
        pasteFromClipboard();
        return false;
      }
      return true;
    });

    // Right-click: copy the selection if there is one, otherwise paste (like Windows Terminal)
    const onContextMenu = (e) => {
      e.preventDefault();
      if (!copySelection()) pasteFromClipboard();
    };
    containerRef.current.addEventListener('contextmenu', onContextMenu);

    // Re-fit whenever the container's size changes (window resize, panel toggled or dragged)
    const resizeObserver = new ResizeObserver(() => {
      safeFit();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (containerRef.current) containerRef.current.removeEventListener('contextmenu', onContextMenu);
      socket.close();
      term.dispose();
    };
  }, []); // a terminal keeps the folder it started in; BottomPanel opens a new one when the folder changes

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', minHeight: '100px' }}
    />
  );
}