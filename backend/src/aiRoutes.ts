import express from 'express';
import { chat, listOllamaModels } from './aiService';
import db from './db';

const router = express.Router();

// GET /api/ai/models — lists what's actually available right now
router.get('/models', async (req, res) => {
    try {
        const ollamaModels = await listOllamaModels();
        const models: { provider: string; model: string; label: string }[] = ollamaModels.map(name => ({
            provider: 'ollama',
            model: name,
            label: `${name} (local)`,
        }));

        if (process.env.OPENAI_API_KEY) {
            models.push({ provider: 'openai', model: 'gpt-4o-mini', label: 'GPT-4o mini (OpenAI)' });
        }
        if (process.env.GROQ_API_KEY) {
            models.push({ provider: 'groq', model: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (Groq)' });
        }
        if (process.env.GEMINI_API_KEY) {
            models.push({ provider: 'gemini', model: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' });
        }

        res.json({ models });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/ai/chat — body: { provider, model, messages, projectId?, fileId? }
router.post('/chat', async (req, res) => {
    const { provider, model, messages, projectId, fileId } = req.body;
    if (!provider || !model || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'provider, model, and messages are required' });
    }
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