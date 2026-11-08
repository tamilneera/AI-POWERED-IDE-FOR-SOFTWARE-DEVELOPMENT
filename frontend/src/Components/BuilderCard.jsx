import { useState, useRef, useEffect } from 'react';
import { BACKEND_URL } from '../config';
import { C } from '../theme';
import {
  isBinaryPath, orderFiles, makeBatches, summarize, summariesText, trimRequirements,
  BUILD_SYSTEM, PLAN_SYSTEM, buildUserPrompt, parsePlan, parseBlocks, askModel,
} from '../builder';

const small = { fontSize: '11px', color: C.muted };
const pill = (enabled, color) => ({
  display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 12px', borderRadius: '14px',
  fontSize: '11px', color: '#fff', userSelect: 'none', whiteSpace: 'nowrap',
  background: enabled ? color : '#2a2e3d', border: `1px solid ${enabled ? color : C.border}`,
  cursor: enabled ? 'pointer' : 'default', opacity: enabled ? 1 : 0.7,
});

export default function BuilderCard({ builder, workspacePath, model }) {
  const [manifest, setManifest] = useState(builder.manifest); // { root, files, dirs }
  const [sub, setSub] = useState(() => (builder.resumed ? '' : (builder.manifest && builder.manifest.root) || ''));
  const [phase, setPhase] = useState(builder.manifest ? 'ready' : 'planning'); // planning | ready | creating | building | paused | fixing | opening | done | error
  const [doneCount, setDoneCount] = useState(builder.done ? builder.done.length : 0);
  const [note, setNote] = useState(builder.resumed ? 'Resuming an unfinished build. Press "Build everything" to continue.' : '');
  const [error, setError] = useState('');
  const [wait, setWait] = useState(0);
  const [log, setLog] = useState([]);
  const [showList, setShowList] = useState(false);
  const [running, setRunning] = useState(''); // address of the project while it runs

  const doneRef = useRef(new Set(builder.done || []));
  const summaries = useRef(new Map());
  const stopRef = useRef(false);
  const structureRef = useRef(!!builder.resumed);
  const planStarted = useRef(false);
  const autoStarted = useRef(false);
  const fixAbort = useRef(null);
  const modelRef = useRef(model);
  modelRef.current = model;

  const files = manifest ? manifest.files : [];
  const codeFiles = files.filter((f) => !isBinaryPath(f));
  const skippedBinary = files.length - codeFiles.length;
  const total = codeFiles.length;
  const todo = codeFiles.filter((f) => !doneRef.current.has(f));
  const calls = makeBatches(orderFiles(todo)).length;

  const say = (line) => setLog((l) => [...l.slice(-11), line]);
  const sepOf = () => ((workspacePath || '').includes('\\') ? '\\' : '/');
  const fullRoot = () => {
    const base = (workspacePath || '').replace(/[\\/]+$/, '');
    const s = sub.trim();
    return s ? base + sepOf() + s : base;
  };
  const pathOf = (rel) => [fullRoot(), ...rel.split('/')].join(sepOf());
  const post = (url, body) => fetch(`${BACKEND_URL}${url}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  // reads a stream of JSON lines; onEvent gets every event
  const readStream = async (res, onEvent) => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n');
      buffer = parts.pop();
      for (const line of parts) {
        if (!line.trim()) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        onEvent(ev);
      }
    }
  };

  // no folder tree in the message: ask the AI for a plan once
  useEffect(() => {
    if (manifest || !builder.needsPlan || planStarted.current) return;
    planStarted.current = true;
    (async () => {
      const m = modelRef.current;
      if (!m) { setError('Pick a model first (next to the message box), then send your message again.'); setPhase('error'); return; }
      try {
        const reply = await askModel({
          backendUrl: BACKEND_URL, model: m, onWait: setWait, shouldStop: () => false,
          messages: [
            { role: 'system', content: PLAN_SYSTEM },
            { role: 'user', content: trimRequirements(builder.requirements) },
          ],
        });
        const plan = parsePlan(reply);
        if (!plan) throw new Error('The AI did not return a readable folder structure. Send your message again, or pick a stronger model.');
        setManifest(plan);
        setSub(plan.root);
        setPhase('ready');
      } catch (err) {
        setError(err.message);
        setPhase('error');
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // progress file, so a build can continue later (even after restarting the IDE)
  const saveState = async () => {
    try {
      await post('/api/files/write', {
        path: pathOf('.ide-builder.json'),
        content: JSON.stringify({
          version: 1, requirements: builder.requirements.slice(0, 12000), files, done: [...doneRef.current],
        }),
      });
    } catch { /* the progress file is only a convenience */ }
  };

  const nameOk = () => /^[\w.\- ]*$/.test(sub) && sub.trim() !== '.' && sub.trim() !== '..';

  const createStructure = async () => {
    if (!workspacePath) { setError('Open a folder first (File → Open Folder).'); return false; }
    if (!nameOk()) { setError('Folder name: use only letters, numbers, spaces, - _ and .'); return false; }
    setError('');
    setPhase('creating');
    setNote('Creating folders and empty files…');
    try {
      for (const d of manifest.dirs) {
        await post('/api/files/mkdir', { path: pathOf(d) });
      }
      for (const f of codeFiles) {
        if (doneRef.current.has(f)) continue;
        // never blank a file that already has content (for example from an earlier build in the same folder)
        try {
          const r = await fetch(`${BACKEND_URL}/api/files/read?path=${encodeURIComponent(pathOf(f))}`);
          if (r.ok) {
            const existing = await r.json();
            if (existing && typeof existing.content === 'string' && existing.content.length > 0) continue;
          }
        } catch { /* the file does not exist yet: create it */ }
        const res = await post('/api/files/write', { path: pathOf(f), content: '' });
        const d = await res.json().catch(() => ({}));
        if (!d.success) throw new Error(d.error || `could not create ${f}`);
      }
      structureRef.current = true;
      await saveState();
      setPhase('ready');
      setNote(`Created ${manifest.dirs.length} folders and ${total} empty files${skippedBinary ? ` (${skippedBinary} binary file${skippedBinary === 1 ? '' : 's'} skipped: add them yourself)` : ''}.`);
      return true;
    } catch (err) {
      setError(err.message);
      setPhase('ready');
      return false;
    }
  };

  // returns true when every file is written
  const runBuild = async () => {
    const m = modelRef.current;
    if (!m) { setError('Pick a model first (next to the message box).'); setPhase('paused'); return false; }
    if (!structureRef.current) {
      const ok = await createStructure();
      if (!ok) return false;
    }
    stopRef.current = false;
    setError('');
    setPhase('building');

    // when continuing, the summaries of the files already written are rebuilt from disk
    if (summaries.current.size === 0 && doneRef.current.size > 0) {
      setNote('Reading the files already written…');
      for (const f of doneRef.current) {
        try {
          const r = await fetch(`${BACKEND_URL}/api/files/read?path=${encodeURIComponent(pathOf(f))}`);
          const d = await r.json();
          if (d && typeof d.content === 'string') summaries.current.set(f, summarize(f, d.content));
        } catch { /* skip this one */ }
      }
    }

    const tries = {};
    const queue = makeBatches(orderFiles(codeFiles.filter((f) => !doneRef.current.has(f))));
    const requirements = trimRequirements(builder.requirements);
    const allPaths = files.slice(0, 150);

    while (queue.length > 0 && !stopRef.current) {
      const batch = queue.shift();
      setNote(`Writing: ${batch.map((p) => p.split('/').pop()).join(', ')}`);
      try {
        const reply = await askModel({
          backendUrl: BACKEND_URL, model: m, onWait: setWait, shouldStop: () => stopRef.current,
          messages: [
            { role: 'system', content: BUILD_SYSTEM },
            { role: 'user', content: buildUserPrompt({ requirements, allPaths, summaries: summariesText(summaries.current), batch }) },
          ],
        });
        const parsed = parseBlocks(reply, batch);
        for (const f of parsed.files) {
          const res = await post('/api/files/write', { path: pathOf(f.path), content: f.content });
          const d = await res.json().catch(() => ({}));
          if (!d.success) throw new Error(d.error || `could not write ${f.path}`);
          doneRef.current.add(f.path);
          summaries.current.set(f.path, summarize(f.path, f.content));
          setDoneCount(doneRef.current.size);
        }
        const missing = batch.filter((p) => !doneRef.current.has(p));
        for (const p of missing) {
          tries[p] = (tries[p] || 0) + 1;
          if (tries[p] <= 1) queue.unshift([p]); // one more try, on its own
          else say(`⚠ Could not get ${p} (left empty)`);
        }
        if (parsed.truncated) say('The answer was cut off; the missing files are retried one by one.');
        await saveState();
      } catch (err) {
        if (err.code === 'STOP') break;
        if (err.code === 'TOO_LARGE' && batch.length > 1) {
          batch.slice().reverse().forEach((p) => queue.unshift([p]));
          say('The request was too big for this model: writing the files one by one.');
          continue;
        }
        setError(err.message);
        setPhase('paused');
        await saveState();
        return false;
      }
    }

    await saveState();
    setWait(0);
    const left = codeFiles.filter((f) => !doneRef.current.has(f)).length;
    if (stopRef.current) {
      setPhase('paused');
      setNote('Stopped. Press "Build everything" when you want to go on.');
      return false;
    }
    if (left === 0) {
      setPhase('ready');
      setNote(`All ${total} files are written.`);
      return true;
    }
    setPhase('paused');
    setNote(`${left} file${left === 1 ? ' is' : 's are'} still empty. Press "Build everything" to try again.`);
    return false;
  };

  // install, start, test and repair: true when every check passed
  const installAndFix = async () => {
    const m = modelRef.current;
    if (!m) { setError('Pick a model first.'); return false; }
    setError('');
    setPhase('fixing');
    setNote('Checking the project: installing packages, starting the server, building the website, fixing errors. This can take several minutes…');
    let ok = false;
    const ctl = new AbortController();
    fixAbort.current = ctl;
    try {
      const res = await fetch(`${BACKEND_URL}/api/autofix/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctl.signal,
        body: JSON.stringify({ provider: m.provider, model: m.model, root: fullRoot(), maxFixes: 4 }),
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Request failed');
      }
      await readStream(res, (ev) => {
        say(String(ev.message).split('\n')[0].slice(0, 320));
        if (ev.type === 'done') ok = true;
        if (ev.type === 'error') setError(String(ev.message).slice(0, 500));
      });
    } catch (err) {
      setError(err.name === 'AbortError' ? 'Stopped.' : err.message);
    }
    fixAbort.current = null;
    setPhase('ready');
    setNote(ok ? 'All checks passed.' : 'Some checks did not pass. Read the messages above, then press "3 · Check and fix" to try again.');
    return ok;
  };

  const openProject = async () => {
    setError('');
    setPhase('opening');
    setNote('Starting the project…');
    let url = '';
    try {
      const res = await post('/api/devrun/start', { root: fullRoot() });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Could not start the project');
      }
      await readStream(res, (ev) => {
        if (ev.type === 'url') url = ev.message;
        else if (ev.type === 'error') setError(String(ev.message).slice(0, 400));
        else say(String(ev.message).split('\n')[0].slice(0, 200));
      });
    } catch (err) {
      setError(err.message);
    }
    setPhase('ready');
    if (url) {
      setRunning(url);
      if (window.electronAPI && window.electronAPI.openExternal) window.electronAPI.openExternal(url);
      else window.open(url, '_blank');
      setNote(`The project is running at ${url} and was opened in your browser.`);
    }
  };

  const stopProject = async () => {
    try { await post('/api/devrun/stop', { root: fullRoot() }); } catch { /* ignore */ }
    setRunning('');
    setNote('The project was stopped.');
  };

  // one click: structure, code, checks, repair, browser
  const runAll = async () => {
    setError('');
    const created = structureRef.current ? true : await createStructure();
    if (!created) return;
    const built = await runBuild();
    if (!built) return;
    const verified = await installAndFix();
    if (verified) await openProject();
  };

  // the card starts by itself once the folder structure is known (Stop cancels)
  useEffect(() => {
    if (!builder.autoRun || builder.resumed || !manifest || autoStarted.current) return;
    autoStarted.current = true;
    runAll();
  }, [manifest]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopAll = () => {
    stopRef.current = true;
    if (fixAbort.current) fixAbort.current.abort();
  };

  const idle = manifest && ['ready', 'paused', 'error'].includes(phase);
  const busy = manifest && ['creating', 'building', 'fixing', 'opening'].includes(phase);
  const canCreate = idle && !structureRef.current && doneCount === 0;
  const canBuild = idle && todo.length > 0;
  const canFix = idle && doneCount > 0 && todo.length === 0;
  const canOpen = idle && doneCount > 0 && !running;

  return (
    <div style={{
      width: '92%', marginTop: '8px', background: C.card, border: `1px solid ${C.border}`,
      borderRadius: '10px', padding: '10px', boxSizing: 'border-box',
    }}>
      <div style={{ color: '#fff', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>🏗️ Project builder</div>

      {phase === 'planning' && (
        <div style={small}>Planning the folder structure…{wait > 0 ? ` (waiting ${wait} s for the rate limit)` : ''}</div>
      )}

      {manifest && (
        <>
          <div style={{ ...small, marginBottom: '6px' }}>
            {manifest.dirs.length} folders · {total} files to write{skippedBinary ? ` · ${skippedBinary} binary skipped` : ''} · about {calls} AI {calls === 1 ? 'call' : 'calls'} left
            {' · '}
            <span onClick={() => setShowList((v) => !v)} style={{ color: '#a99dff', cursor: 'pointer' }}>{showList ? 'hide list' : 'show list'}</span>
          </div>
          {showList && (
            <div style={{
              maxHeight: '120px', overflowY: 'auto', fontSize: '11px', color: '#c9cde0',
              fontFamily: 'Consolas, monospace', marginBottom: '8px',
            }}>
              {files.map((f) => (
                <div key={f} style={{ color: doneRef.current.has(f) ? '#7ee2a8' : '#c9cde0' }}>
                  {doneRef.current.has(f) ? '✓ ' : '· '}{f}{isBinaryPath(f) ? ' (binary, skipped)' : ''}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', ...small, marginBottom: '8px' }}>
            <span>Project folder (inside the open folder):</span>
            <input
              value={sub}
              onChange={(e) => setSub(e.target.value)}
              disabled={!canCreate}
              placeholder="empty = the open folder"
              style={{
                flex: 1, minWidth: 0, background: C.panel, color: C.text, border: `1px solid ${C.border}`,
                borderRadius: '6px', padding: '3px 6px', fontSize: '11px', outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
            <span onClick={idle ? runAll : undefined} style={{ ...pill(idle, '#6d5ef5'), fontSize: '12px', padding: '5px 16px' }}>
              ✨ {doneCount > 0 ? 'Continue everything' : 'Build everything'}
            </span>
            {busy && <span onClick={stopAll} style={pill(true, '#b5483f')}>⏸ Stop</span>}
            {running && <span onClick={stopProject} style={pill(true, '#b5483f')}>■ Stop project</span>}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
            <span style={small}>Or step by step:</span>
            <span onClick={canCreate ? createStructure : undefined} style={pill(canCreate, C.accent)}>1 · Folders</span>
            <span onClick={canBuild ? runBuild : undefined} style={pill(canBuild, '#2f8f5b')}>2 · Write code</span>
            <span onClick={canFix ? installAndFix : undefined} style={pill(canFix, '#3b6fb5')}>3 · Check and fix</span>
            <span onClick={canOpen ? openProject : undefined} style={pill(canOpen, '#8a5cc2')}>4 · Open in browser</span>
          </div>

          <div style={{ height: '6px', background: '#262a38', borderRadius: '3px', overflow: 'hidden', margin: '10px 0 4px' }}>
            <div style={{ width: `${total ? (doneCount / total) * 100 : 0}%`, height: '100%', background: '#4cd38a' }} />
          </div>
          <div style={small}>{doneCount} of {total} files written</div>
        </>
      )}

      {wait > 0 && phase !== 'planning' && (
        <div style={{ ...small, color: '#f0b429', marginTop: '4px' }}>
          Waiting {wait} s because the model's rate limit was reached. It continues by itself.
        </div>
      )}
      {note && <div style={{ ...small, color: '#c9cde0', marginTop: '4px' }}>{note}</div>}
      {error && <div style={{ fontSize: '11px', color: '#ff9aa8', marginTop: '4px', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{error}</div>}
      {log.length > 0 && (
        <div style={{
          marginTop: '6px', maxHeight: '130px', overflowY: 'auto', background: '#0d0f16', border: `1px solid ${C.border}`,
          borderRadius: '6px', padding: '5px 8px', fontSize: '11px', fontFamily: 'Consolas, monospace', color: '#c9cde0',
        }}>
          {log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
      {manifest && (
        <div style={{ ...small, marginTop: '6px' }}>
          A project that uses a database needs it running before the server can start (for example MongoDB, or a free Atlas address in server/.env).
        </div>
      )}
    </div>
  );
}