require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!OPENAI_API_KEY) {
  console.warn('OPENAI_API_KEY is not set. The server will fail requests until it is configured.');
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/api/config', (_req, res) => {
  res.json({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
  });
});

app.get('/api/memories', async (req, res) => {
  try {
    const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
    const memories = await loadMemories(userId);
    const normalized = normalizeMemories(memories);

    return res.json({
      profile: normalized.profile,
      goals: normalized.goals,
      facts: normalized.facts,
    });
  } catch (error) {
    console.error('Failed to load memories from the API.', error);
    return res.status(500).json({ error: error.message || 'Unexpected error.' });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const prompt = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    const accessToken = typeof req.body?.accessToken === 'string' ? req.body.accessToken.trim() : '';

    console.log('[memory] userId', userId);

    if (!prompt) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the server.' });
    }

    const memories = await loadMemories(userId);
    console.log('[memory] loaded memories', memories);
    const systemPrompt = buildMemorySystemPrompt(memories);
    const recentHistory = await loadRecentConversationHistory(userId, 20);
    console.log('[memory] recent conversation history', recentHistory);
    console.log('[memory] generated system prompt', systemPrompt);

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(buildRequestBody(prompt, systemPrompt, recentHistory)),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'OpenAI request failed.');
    }

    const reply = extractText(data) || 'No response returned.';
    const nextMemories = updateMemoriesFromConversation(memories, prompt, reply);
    await saveMemories(nextMemories, userId, accessToken);

    return res.json({ reply });
  } catch (error) {
    console.error('Chat request failed:', error);
    return res.status(500).json({ error: error.message || 'Unexpected error.' });
  }
});

function getSupabaseHeaders(includeJson = false, accessToken = '') {
  const headers = {};
  const accessKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

  if (!accessKey) {
    return headers;
  }

  headers.apikey = accessKey;

  if (includeJson) {
    headers['Content-Type'] = 'application/json';
  }

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  } else if (SUPABASE_SERVICE_ROLE_KEY) {
    headers.Authorization = `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  }

  return headers;
}

function normalizeMemories(memories = {}) {
  const source = memories && typeof memories === 'object' ? memories : {};
  const profile = typeof source.profile === 'string' ? source.profile.trim() : '';
  const goals = Array.isArray(source.goals)
    ? source.goals.filter((goal) => typeof goal === 'string' && goal.trim()).map((goal) => goal.trim())
    : [];
  const facts = Array.isArray(source.facts)
    ? source.facts.filter((fact) => typeof fact === 'string' && fact.trim()).map((fact) => fact.trim())
    : [];

  return { profile, goals, facts };
}

function serializeMemoryForSupabase(memories = {}) {
  const normalized = normalizeMemories(memories);
  return {
    profile: normalized.profile,
    goals: normalized.goals,
    facts: normalized.facts,
  };
}

function parseMemoryPayload(payload = {}) {
  return normalizeMemories(payload);
}

function buildMemoriesFromRows(rows = [], fallbackMemories = {}) {
  const next = normalizeMemories(fallbackMemories);
  let pendingUserMessage = '';

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const role = row?.role === 'assistant' ? 'assistant' : 'user';
    const message = typeof row?.message === 'string' ? row.message.trim() : '';

    if (!message) {
      return;
    }

    if (message.startsWith('profile:')) {
      const profile = message.replace(/^profile:/i, '').trim();
      if (profile) {
        next.profile = profile;
      }
      return;
    }

    if (message.startsWith('goal:')) {
      const goal = message.replace(/^goal:/i, '').trim();
      if (goal && !next.goals.includes(goal)) {
        next.goals.push(goal);
      }
      return;
    }

    if (message.startsWith('fact:')) {
      const fact = message.replace(/^fact:/i, '').trim();
      if (fact && !next.facts.includes(fact)) {
        next.facts.push(fact);
      }
      return;
    }

    if (role === 'user') {
      pendingUserMessage = message;
      return;
    }

    if (role === 'assistant' && pendingUserMessage) {
      const updated = updateMemoriesFromConversation(next, pendingUserMessage, message);
      Object.assign(next, updated);
      pendingUserMessage = '';
    }
  });

  if (pendingUserMessage) {
    const updated = updateMemoriesFromConversation(next, pendingUserMessage, '');
    Object.assign(next, updated);
  }

  console.log("=== PARSED MEMORY ===");
  console.log(next);
  console.log("=====================");
  return normalizeMemories(next);
}

async function loadMemories(userId = '') {
  if (!userId) {
    return { profile: '', goals: [], facts: [] };
  }

  const accessToken = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !accessToken) {
    return { profile: '', goals: [], facts: [] };
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/messages?select=id,user_id,role,message,created_at&user_id=eq.${encodeURIComponent(userId)}&order=created_at.asc`, {
      headers: getSupabaseHeaders(),
    });

    if (!response.ok) {
      return { profile: '', goals: [], facts: [] };
    }

    const rows = await response.json();
    console.log("=== SUPABASE ROWS ===");
    console.log(rows);
    console.log("=====================");
    return buildMemoriesFromRows(rows);
  } catch (error) {
    console.error('Failed to load memories from Supabase.', error);
    return { profile: '', goals: [], facts: [] };
  }
}

async function saveMemories(memories = {}, userId = '', accessToken = '') {
  if (!userId) {
    return;
  }

  const resolvedAccessToken = accessToken || SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !resolvedAccessToken) {
    return;
  }

  const normalized = serializeMemoryForSupabase(memories);
  const rows = [
    ...(normalized.profile ? [{ user_id: userId, role: 'assistant', message: `profile:${normalized.profile}`, created_at: new Date().toISOString() }] : []),
    ...normalized.goals.map((goal) => ({ user_id: userId, role: 'assistant', message: `goal:${goal}`, created_at: new Date().toISOString() })),
    ...normalized.facts.map((fact) => ({ user_id: userId, role: 'assistant', message: `fact:${fact}`, created_at: new Date().toISOString() })),
  ];

  if (!rows.length) {
    return;
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
      method: 'POST',
      headers: getSupabaseHeaders(true, accessToken),
      body: JSON.stringify(rows),
    });

    if (!response.ok) {
      console.error('Failed to save memories to Supabase.', await response.text());
    }
  } catch (error) {
    console.error('Failed to save memories to Supabase.', error);
  }
}

function isMemoryRow(message = '') {
  const text = String(message || '').trim();
  return text.startsWith('profile:') || text.startsWith('goal:') || text.startsWith('fact:');
}

async function loadRecentConversationHistory(userId = '', limit = 20) {
  if (!userId) {
    return [];
  }

  const accessKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !accessKey) {
    return [];
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/messages?select=id,user_id,role,message,created_at&user_id=eq.${encodeURIComponent(userId)}&order=created_at.asc`, {
      headers: getSupabaseHeaders(),
    });

    if (!response.ok) {
      return [];
    }

    const rows = await response.json();
    const conversationMessages = (Array.isArray(rows) ? rows : [])
      .map((row) => {
        const role = row?.role === 'assistant' ? 'assistant' : 'user';
        const text = typeof row?.message === 'string' ? row.message.trim() : '';
        return { role, text };
      })
      .filter((item) => item.text && !isMemoryRow(item.text));

    return conversationMessages.slice(Math.max(0, conversationMessages.length - limit));
  } catch (error) {
    console.error('Failed to load recent conversation history from Supabase.', error);
    return [];
  }
}

function buildMemorySystemPrompt(memories = {}) {
  const normalized = normalizeMemories(memories);
  const memoryText = [
    normalized.profile ? `User profile: ${normalized.profile}` : null,
    normalized.goals.length ? `Goals: ${normalized.goals.join('; ')}` : null,
    normalized.facts.length ? `Important facts: ${normalized.facts.join('; ')}` : null,
  ].filter(Boolean).join('\n');

  if (!memoryText) {
    return 'You are a helpful assistant.';
  }

  return `You are a helpful assistant.\n\n${memoryText}\n\nUse the stored memory as context when relevant.`;
}

function updateMemoriesFromConversation(memories = {}, userPrompt = '', assistantReply = '') {
  const normalized = normalizeMemories(memories);
  const next = {
    profile: normalized.profile,
    goals: [...normalized.goals],
    facts: [...normalized.facts],
  };

  const userText = String(userPrompt || '').trim();
  const assistantText = String(assistantReply || '').trim();

  const profileMatch =
    userText.match(/benim adım\s+(.+?)(?=\.|,|\n|$)/i) ||
    userText.match(/adım\s+(.+?)(?=\.|,|\n|$)/i) ||
    userText.match(/my name is\s+(.+?)(?=\s+and\s+|\s+but\s+|\s+who\s+|\.|,|\n|$)/i) ||
    userText.match(/i['’]m\s+(.+?)(?=\s+and\s+|\s+but\s+|\s+who\s+|\.|,|\n|$)/i) ||
    userText.match(/i am\s+(.+?)(?=\s+and\s+|\s+but\s+|\s+who\s+|\.|,|\n|$)/i) ||
    userText.match(/i work as\s+(.+?)(?=\s+and\s+|\s+but\s+|\s+who\s+|\.|,|\n|$)/i) ||
    userText.match(/i live in\s+(.+?)(?=\s+and\s+|\s+but\s+|\s+who\s+|\.|,|\n|$)/i) ||
    userText.match(/i am from\s+(.+?)(?=\s+and\s+|\s+but\s+|\s+who\s+|\.|,|\n|$)/i);

  if (profileMatch?.[1]) {
    const profile = profileMatch[1].trim();
    if (profile && !next.profile) {
      next.profile = profile;
    }
  }

  const goalMatches = userText.match(/my goal is\s+(.+?)(?:\.|,|\n|$)/i);
  if (goalMatches?.[1]) {
    const goal = goalMatches[1].trim();
    if (goal && !next.goals.includes(goal)) {
      next.goals.push(goal);
    }
  }

  const factMatches = userText.match(/ben\s+(.+?)\s+yaşıyorum(?=\s|\.|,|\n|$)/i)
    || userText.match(/(.+?)\s+yaşıyorum(?=\s|\.|,|\n|$)/i)
    || userText.match(/(.+?)\s+kullanıyorum(?=\s|\.|,|\n|$)/i)
    || userText.match(/(.+?)\s+ile\s+çalışıyorum(?=\s|\.|,|\n|$)/i)
    || userText.match(/(.+?)\s+geliştiriyorum(?=\s|\.|,|\n|$)/i)
    || userText.match(/(.+?)\s+istiyorum(?=\s|\.|,|\n|$)/i)
    || userText.match(/(.+?)\s+sahibim(?=\s|\.|,|\n|$)/i)
    || userText.match(/i live in\s+(.+?)(?=\s+and\s+|\s+but\s+|\s+or\s+|\.|,|;|:|\n|$)/i)
    || userText.match(/i use\s+(.+?)(?=\s+and\s+|\s+but\s+|\s+or\s+|\.|,|;|:|\n|$)/i)
    || userText.match(/i work with\s+(.+?)(?=\s+and\s+|\s+but\s+|\s+or\s+|\.|,|;|:|\n|$)/i)
    || userText.match(/i study\s+(.+?)(?=\s+and\s+|\s+but\s+|\s+or\s+|\.|,|;|:|\n|$)/i)
    || userText.match(/i build\s+(.+?)(?=\s+and\s+|\s+but\s+|\s+or\s+|\.|,|;|:|\n|$)/i)
    || userText.match(/i want\s+(.+?)(?=\s+and\s+|\s+but\s+|\s+or\s+|\.|,|;|:|\n|$)/i)
    || userText.match(/i need\s+(.+?)(?=\s+and\s+|\s+but\s+|\s+or\s+|\.|,|;|:|\n|$)/i)
    || userText.match(/i have\s+(.+?)(?=\s+and\s+|\s+but\s+|\s+or\s+|\.|,|;|:|\n|$)/i);

  if (factMatches?.[1]) {
    const fact = factMatches[1].trim();
    if (fact && !next.facts.includes(fact)) {
      next.facts.push(fact);
    }
  }

  return next;
}

function buildRequestBody(prompt, systemPrompt = '', conversationHistory = []) {
  const normalizedHistory = (Array.isArray(conversationHistory) ? conversationHistory : [])
    .filter((entry) => entry && typeof entry.text === 'string' && entry.text.trim())
    .map((entry) => ({
      role: entry.role === 'assistant' ? 'assistant' : 'user',
      text: String(entry.text).trim(),
    }));

  const input = normalizedHistory.map((entry) => ({
    role: entry.role,
    content: entry.text,
  }));

  input.push({
    role: 'user',
    content: prompt,
  });

  if (systemPrompt || normalizedHistory.length) {
    return {
      model: 'gpt-4.1-mini',
      instructions: systemPrompt,
      input,
      temperature: 0.7,
    };
  }

  return {
    model: 'gpt-4.1-mini',
    input: prompt,
    temperature: 0.7,
  };
}

function extractText(payload) {
  const output = payload?.output?.[0];
  const content = output?.content?.find((item) => item?.type === 'output_text');
  return content?.text || '';
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

module.exports = { app, buildRequestBody, extractText, serializeMemoryForSupabase, parseMemoryPayload, buildMemoriesFromRows, saveMemories };