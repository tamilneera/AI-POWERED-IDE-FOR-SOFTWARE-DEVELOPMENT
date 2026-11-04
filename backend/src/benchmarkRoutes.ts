import express from 'express';
import { performance } from 'perf_hooks';
import { chat } from './aiService';

const router = express.Router();

// only these read-only paths can be load-tested
const LOAD_PATHS = ['/api/health', '/api/settings', '/api/ai/quality-history'];

const round1 = (n: number) => Math.round(n * 10) / 10;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return round1(sorted[idx]);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timed out')), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

// POST /api/benchmark/load   body: { path, requests, concurrency }
// Sends many requests to one of this backend's own endpoints and reports response times.
router.post('/load', async (req, res) => {
  const body = req.body || {};
  const target: string = body.path || '/api/health';
  if (!LOAD_PATHS.includes(target)) {
    return res.status(400).json({ error: `path must be one of: ${LOAD_PATHS.join(', ')}` });
  }
  const total = Math.min(Math.max(1, Number(body.requests) || 100), 1000);
  const workers = Math.min(Math.max(1, Number(body.concurrency) || 10), 50);
  const base = `http://127.0.0.1:${req.socket.localPort}`;

  const times: number[] = [];
  let ok = 0;
  let failed = 0;
  let next = 0;
  const started = performance.now();

  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= total) return;
      const t0 = performance.now();
      try {
        const r = await fetch(base + target);
        await r.text();
        if (r.ok) ok++; else failed++;
      } catch {
        failed++;
      }
      times.push(performance.now() - t0);
    }
  };
  await Promise.all(Array.from({ length: workers }, worker));

  const seconds = (performance.now() - started) / 1000;
  const sorted = [...times].sort((a, b) => a - b);
  const avg = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;
  res.json({
    path: target,
    requests: total,
    concurrency: workers,
    ok,
    failed,
    durationSeconds: Math.round(seconds * 100) / 100,
    requestsPerSecond: round1(total / Math.max(seconds, 0.001)),
    latencyMs: {
      min: round1(sorted[0] || 0),
      avg: round1(avg),
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      max: round1(sorted[sorted.length - 1] || 0),
    },
    note: 'The test tool runs on the same computer as the backend, so use these numbers to compare changes, not as absolute limits.',
  });
});

// POST /api/benchmark/ai-latency   body: { provider, model, runs, prompt }
// The first run of a local model includes loading it into memory (cold start).
router.post('/ai-latency', async (req, res) => {
  const body = req.body || {};
  const { provider, model } = body;
  if (!provider || !model) return res.status(400).json({ error: 'provider and model are required' });
  const runs = Math.min(Math.max(1, Number(body.runs) || 3), 5);
  const prompt = String(body.prompt || 'Reply with the single word OK.').slice(0, 2000);

  const results: { run: number; ms: number; ok: boolean; chars?: number; error?: string }[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    try {
      const reply = await withTimeout(
        chat({ provider, model, messages: [{ role: 'user', content: prompt }] }),
        120000
      );
      results.push({ run: i + 1, ms: Math.round(performance.now() - t0), ok: true, chars: reply.length });
    } catch (err: any) {
      results.push({ run: i + 1, ms: Math.round(performance.now() - t0), ok: false, error: err.message });
    }
  }

  const good = results.filter((r) => r.ok);
  const msList = good.map((r) => r.ms);
  const warm = good.slice(1).map((r) => r.ms);
  const charsPerSecond = good.length
    ? good.reduce((a, r) => a + (r.chars || 0) / Math.max(r.ms / 1000, 0.001), 0) / good.length
    : 0;
  res.json({
    provider,
    model,
    runs: results,
    successful: good.length,
    minMs: msList.length ? Math.min(...msList) : null,
    avgMs: msList.length ? Math.round(msList.reduce((a, b) => a + b, 0) / msList.length) : null,
    maxMs: msList.length ? Math.max(...msList) : null,
    firstRunMs: good.length ? good[0].ms : null,
    avgAfterFirstMs: warm.length ? Math.round(warm.reduce((a, b) => a + b, 0) / warm.length) : null,
    approxTokensPerSecond: round1(charsPerSecond / 4),
  });
});

export default router;