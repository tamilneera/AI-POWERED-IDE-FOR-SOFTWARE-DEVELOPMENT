import { Server } from 'http';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import fs from 'fs';

// Every browser terminal tab opens one WebSocket. The frontend sends:
//   { type: 'input', data: '<one line>' }      when you press Enter
// and this server answers with:
//   { type: 'output', data: '...' }            text from the shell
//   { type: 'exit', code: 0 }                  when the shell ends
// The frontend connects with  ws://host:port/?cwd=<folder open in the IDE>  so the shell starts in that folder.
export function setupTerminalServer(server: Server) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (socket, req) => {
    // folder the shell should start in (the folder open in the IDE)
    let cwd = process.cwd();
    try {
      const requested = new URL(req.url || '/', 'http://localhost').searchParams.get('cwd');
      if (requested && fs.existsSync(requested) && fs.statSync(requested).isDirectory()) {
        cwd = requested;
      }
    } catch {
      /* bad URL: keep the default folder */
    }

    const isWindows = process.platform === 'win32';
    const shell = isWindows ? (process.env.ComSpec || 'cmd.exe') : (process.env.SHELL || 'bash');
    const child = spawn(shell, [], { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });

    const send = (obj: unknown) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(obj));
    };
    // xterm needs \r\n for a new line
    const toTerminal = (chunk: Buffer) => chunk.toString().replace(/\r?\n/g, '\r\n');

    child.stdout.on('data', (chunk: Buffer) => send({ type: 'output', data: toTerminal(chunk) }));
    child.stderr.on('data', (chunk: Buffer) => send({ type: 'output', data: toTerminal(chunk) }));
    child.on('error', (err) => send({ type: 'output', data: `Could not start shell: ${err.message}\r\n` }));
    child.on('exit', (code) => {
      send({ type: 'exit', code });
      socket.close();
    });

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'input' && typeof msg.data === 'string' && child.stdin.writable) {
          child.stdin.write(msg.data + (isWindows ? '\r\n' : '\n'));
        }
      } catch {
        /* ignore malformed messages */
      }
    });

    socket.on('close', () => {
      if (!child.killed) child.kill();
    });
  });
}