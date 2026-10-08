type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string };

interface ChatOptions {
    provider: 'ollama' | 'openai' | 'groq' | 'gemini';
    model: string;
    messages: ChatMessage[];
}

async function chatWithOllama(model: string, messages: ChatMessage[]): Promise<string> {
    const res = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: false, keep_alive: '30m' }),
    });
    const data: any = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ollama request failed — is Ollama running?');
    return data.message?.content || '';
}

async function chatWithOpenAI(model: string, messages: ChatMessage[]): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY not set in backend/.env');
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages }),
    });
    const data: any = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'OpenAI request failed');
    return data.choices?.[0]?.message?.content || '';
}

async function chatWithGroq(model: string, messages: ChatMessage[]): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY not set in backend/.env');
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages }),
    });
    const data: any = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Groq request failed');
    return data.choices?.[0]?.message?.content || '';
}

async function chatWithGemini(model: string, messages: ChatMessage[]): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not set in backend/.env');
    const contents = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
    }));
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents }),
        }
    );
    const data: any = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Gemini request failed');
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

export async function chat(options: ChatOptions): Promise<string> {
    switch (options.provider) {
        case 'ollama': return chatWithOllama(options.model, options.messages);
        case 'openai': return chatWithOpenAI(options.model, options.messages);
        case 'groq': return chatWithGroq(options.model, options.messages);
        case 'gemini': return chatWithGemini(options.model, options.messages);
        default: throw new Error('Unknown provider: ' + options.provider);
    }
}

export async function listOllamaModels(): Promise<string[]> {
    try {
        const res = await fetch('http://localhost:11434/api/tags');
        const data: any = await res.json();
        return (data.models || []).map((m: any) => m.name);
    } catch {
        return []; // Ollama not running — fail quietly, don't crash the route
    }
}