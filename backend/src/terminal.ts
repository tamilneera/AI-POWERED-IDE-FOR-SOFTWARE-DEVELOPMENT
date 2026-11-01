import { Server } from 'http';
import { WebSocketServer } from 'ws';
import { spawn, exec, ChildProcess } from 'child_process';
import fs from 'fs';

// Every browser terminal tab opens one WebSocket. The frontend sends:
//   { type: 'input', data: '<one line>' }      when you press Enter
//   { type: 'interrupt' }                      when you press Ctrl+C with nothing selected
// and this server answers with:
//   { type: 'output', data: '...' }            text from the shell
//   { type: 'exit', code: 0 }                  when the shell ends
// The frontend connects with  ws://host:port/?cwd=<folder open in the IDE>  so the shell starts in that folder.

// Stops whatever the shell is running (npm start, node ...) but keeps the shell itself alive
// Stops whatever the shell is running (npm start, node ...) but keeps the shell itself alive
function interruptChildren(shellPid?: number) {
  if (!shellPid) return;
  if (process.platform === 'win32') {
    const script =
      `$kids = Get-CimInstance Win32_Process -Filter "ParentProcessId=${shellPid}"; ` +
      `foreach ($k in $kids) { taskkill /PID $k.ProcessId /T /F }`;
    // encoded so no quotes can break on the way to PowerShell
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, (err, stdout) => {
      const out = (stdout || '').trim();
      console.log(`[terminal] Ctrl+C on shell ${shellPid}:`, out || '(no child process found)', err ? `ERROR: ${err.message}` : '');
    });
  } else {
    exec(`pkill -INT -P ${shellPid}`);
  }
}

// Kills the shell AND everything it started (used when a terminal tab is closed)
function killShellTree(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    exec(`taskkill /PID ${child.pid} /T /F`);
  } else {
    child.kill();
  }
}

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
        if (msg.type === 'interrupt') {
          interruptChildren(child.pid);
          // after the app is stopped, press Enter once so the shell prints a fresh prompt
          setTimeout(() => {
            if (child.stdin.writable) child.stdin.write(isWindows ? '\r\n' : '\n');
          }, 500);
        }
      } catch {
        /* ignore malformed messages */
      }
    });

    socket.on('close', () => {
      killShellTree(child);
    });
  });
}