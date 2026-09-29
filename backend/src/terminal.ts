import { WebSocketServer, WebSocket } from 'ws';
import { spawn} from 'child_process';
import type { Server } from 'http';

export function setupTerminalServer(server: Server) {
  const wss = new WebSocketServer({ server, path: '/terminal' });

  wss.on('connection', (ws: WebSocket) => {
    console.log('Terminal client connected');

    const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
    const child = spawn(shell, [], {
      cwd: process.env.USERPROFILE || process.cwd(),
      shell: true
    });

    child.stdout.on('data', (data) => {
      ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
    });

    child.stderr.on('data', (data) => {
      ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
    });

    child.on('close', (code) => {
      ws.send(JSON.stringify({ type: 'exit', code }));
    });

    ws.on('message', (message: string) => {
      try {
        const msg = JSON.parse(message.toString());
        if (msg.type === 'input') {
          child.stdin.write(msg.data + '\n');
        }
      } catch (err) {
        console.error('Invalid message from client:', err);
      }
    });

    ws.on('close', () => {
      console.log('Terminal client disconnected');
      child.kill();
    });
  });

  console.log('Terminal WebSocket server ready at /terminal');
}