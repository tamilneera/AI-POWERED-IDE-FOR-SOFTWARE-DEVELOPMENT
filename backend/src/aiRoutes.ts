import express from 'express';
import { chat, listOllamaModels } from './aiService';
import db from './db';

const router = express.Router();

type ModelOption = { provider: string; model: string; label: string };

const CACHE_MS = 10 * 60 * 1000; // re-test cloud models at most every 10 minutes
let cloudCache: { at: number; models: ModelOption[] } | null = null;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timed out')), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

// Sends one tiny request. If it fails, the model is not offered in the dropdown.
async function works(m: ModelOption): Promise<boolean> {
  try {
    await withTimeout(
      chat({
        provider: m.provider as any,
        model: m.model,
        messages: [{ role: 'user', content: 'Reply with OK' }],
      }),
      20000
    );
    console.log(`Model OK ${m.provider}:${m.model}`);
    return true;
  } catch (err: any) {
    console.log(`Hiding model ${m.provider}:${m.model} — ${err.message}`);
    return false;
  }
}

// Asks Google which models this API key can see
async function geminiCandidates(): Promise<ModelOption[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=100`);
    const data: any = await res.json();
    return (data.models || [])
      .filter((m: any) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .filter((m: any) => /gemini/.test(m.name) && /flash/.test(m.name))
      .filter((m: any) => !/tts|image|live|audio|embedding|robotics|computer/.test(m.name))
      .slice(0, 8)
      .map((m: any) => {
        const id = String(m.name).replace('models/', '');
        return { provider: 'gemini', model: id, label: `${m.displayName || id} (Gemini)` };
      });
  } catch {
    return [];
  }
}

// Models the Groq key can use. Groq's catalog changes often, so it is asked from Groq instead of being fixed in the code.
async function groqCandidates(): Promise<ModelOption[]> {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    console.log('Groq: GROQ_API_KEY is not set in backend/.env, so no Groq models are offered.');
    return [];
  }
  let ids: string[] = [];
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${key}` } });
    const data: any = await res.json();
    if (!res.ok || data.error) {
      console.log('Groq: could not list models:', (data.error && data.error.message) || `HTTP ${res.status}`);
      return [];
    }
    ids = (data.data || []).map((m: any) => String(m.id));
  } catch (err: any) {
    console.log('Groq: could not reach api.groq.com:', err.message);
    return [];
  }
  // only chat models (no speech, guard or embedding models)
  const chatModels = ids.filter((id) => !/whisper|tts|guard|playai|orpheus|embed|safeguard|compound/i.test(id));
  // extra names can be added in backend/.env: GROQ_MODELS=model-a,model-b
  const extra = (process.env.GROQ_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const preferred = ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant', 'qwen/qwen3-32b'];
  const picked = [...extra, ...preferred.filter((id) => chatModels.includes(id)), ...chatModels];
  // at most 4: every model is tested with one request, and free limits are small
  return Array.from(new Set(picked)).slice(0, 4).map((id) => ({ provider: 'groq', model: id, label: `${id} (Groq)` }));
}

async function workingCloudModels(forceRefresh: boolean): Promise<ModelOption[]> {
  if (!forceRefresh && cloudCache && Date.now() - cloudCache.at < CACHE_MS) {
    return cloudCache.models;
  }

  const candidates: ModelOption[] = [...(await geminiCandidates())];
  if (process.env.OPENAI_API_KEY) {
    candidates.push({ provider: 'openai', model: 'gpt-4o-mini', label: 'GPT-4o mini (OpenAI)' });
  }
  candidates.push(...(await groqCandidates()));

  const results = await Promise.all(candidates.map(works));
  const models = candidates.filter((_, i) => results[i]);
  cloudCache = { at: Date.now(), models };
  return models;
}

// GET /api/ai/models  (add ?refresh=1 to re-test cloud models right now)
router.get('/models', async (req, res) => {
  try {
    // Optional manual hide list in backend/.env, e.g. HIDE_MODELS=qwen2.5-coder:latest,gemini-3-flash-preview
    const hidden = new Set(
      (process.env.HIDE_MODELS || '').split(',').map(s => s.trim()).filter(Boolean)
    );
    const isHidden = (m: ModelOption) => hidden.has(m.model) || hidden.has(`${m.provider}:${m.model}`);

    const ollamaModels = await listOllamaModels();
    const local: ModelOption[] = ollamaModels.map(name => ({
      provider: 'ollama',
      model: name,
      label: `${name} (local)`,
    }));

    const cloud = await workingCloudModels(req.query.refresh === '1');

    res.json({ models: [...local, ...cloud].filter(m => !isHidden(m)) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/chat
router.post('/chat', async (req, res) => {
  const { provider, model, messages, projectId, fileId } = req.body;
  if (!provider || !model || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'provider, model, and messages are required' });
  }
  console.log(`AI chat → ${provider}:${model}`);
  try {
    const reply = await chat({ provider, model, messages });

    const lastUserMessage = [...messages].reverse().find((m: any) => m.role === 'user');
    db.prepare(
      `INSERT INTO chat_logs (project_id, file_id, prompt, ai_response, model_used) VALUES (?, ?, ?, ?, ?)`
    ).run(projectId ?? null, fileId ?? null, lastUserMessage?.content ?? '', reply, `${provider}:${model}`);

    res.json({ reply });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;