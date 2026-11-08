import { useEffect, useState } from 'react';
import { BACKEND_URL } from './config';

// The agent run lives here, outside React, so it keeps going when the chat tab is closed
// or the chat panel re-renders. AgentCard only displays what is stored here.

const runs = new Map(); // id -> run

function notify(run) {
  if (run.timer) return;
  run.timer = setTimeout(() => { // coalesce fast output into ~10 updates per second
    run.timer = null;
    run.listeners.forEach((f) => f());
  }, 100);
}

function apply(run, ev) {
  const cmd = (id) => run.items.find((it) => it.k === 'cmd' && it.id === id);
  switch (ev.t) {
    case 'step': run.step = ev.n; run.max = ev.max; run.waiting = 0; break;
    case 'wait': run.waiting = ev.seconds; break;
    case 'ai': run.items.push({ k: 'ai', text: ev.text }); break;
    case 'file': run.items.push({ k: 'file', path: ev.path, lines: ev.lines, created: ev.created }); break;
    case 'cmd': run.items.push({ k: 'cmd', id: ev.id, cwd: ev.cwd, command: ev.command, server: ev.server, out: '', status: 'running' }); break;
    case 'out': { const c = cmd(ev.id); if (c) c.out = (c.out + ev.data).slice(-6000); break; }
    case 'cmd_end': { const c = cmd(ev.id); if (c) { c.status = ev.status; c.code = ev.code; if (ev.url) c.url = ev.url; } break; }
    case 'http': run.items.push({ k: 'http', method: ev.method, url: ev.url, status: ev.status }); break;
    case 'url': run.url = ev.url; break;
    case 'done': run.status = 'done'; run.summary = ev.message; if (ev.url) run.url = ev.url; break;
    case 'error': run.status = 'error'; run.error = ev.message; break;
    default: break;
  }
}

export function startRun(id, { goal, root, model, maxSteps }) {
  if (runs.has(id)) return; // starting twice (React StrictMode) must not run twice
  const run = {
    id, items: [], status: 'running', step: 0, max: 0, waiting: 0, url: null, summary: '', error: '',
    listeners: new Set(), timer: null, controller: new AbortController(),
  };
  runs.set(id, run);

  (async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/agent/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: model.provider, model: model.model, goal, root, maxSteps }),
        signal: run.controller.signal,
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        run.status = 'error';
        run.error = d.error || 'The backend did not accept the request. Restart the backend.';
      } else {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            if (!line.trim()) continue;
            try { apply(run, JSON.parse(line)); } catch { /* ignore a broken line */ }
          }
          notify(run);
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') run.status = 'stopped';
      else { run.status = 'error'; run.error = err.message; }
    }
    if (run.status === 'running') { run.status = 'error'; run.error = 'The connection to the backend closed unexpectedly.'; }
    run.items.forEach((it) => { if (it.k === 'cmd' && it.status === 'running' && !it.server) it.status = 'failed'; });
    notify(run);
  })();
}

export function getRun(id) { return runs.get(id); }

// ■ Stop: ends the agent loop (and the command it is running). Servers it started keep running.
export function stopRun(id) {
  const run = runs.get(id);
  if (run && run.status === 'running') run.controller.abort();
}

// stops the servers (backend + website) the agent started
export async function stopServers() {
  try { await fetch(`${BACKEND_URL}/api/agent/stop`, { method: 'POST' }); } catch { /* backend is gone */ }
}

export function openUrl(url) {
  if (window.electronAPI && window.electronAPI.openExternal) window.electronAPI.openExternal(url);
  else window.open(url, '_blank');
}

export function useRun(id) {
  const [, force] = useState(0);
  useEffect(() => {
    const run = runs.get(id);
    if (!run) return undefined;
    const f = () => force((n) => n + 1);
    run.listeners.add(f);
    f(); // pick up anything that happened while the card was not on screen
    return () => run.listeners.delete(f);
  }, [id]);
  return runs.get(id);
}