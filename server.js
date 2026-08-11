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
    console.log('[memory] recent conversation history JSON:\n' + JSON.stringify(recentHistory, null, 2));
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
    const extractedMemories = await extractMemoryWithAI(prompt);
    const nextMemories = {
      profile: extractedMemories?.profile || memories?.profile || '',
      goals: Array.from(new Set([...(memories?.goals || []), ...(extractedMemories?.goals || [])])),
      facts: Array.from(new Set([...(memories?.facts || []), ...(extractedMemories?.facts || [])])),
    };
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

function isExplicitMemoryMessage(message = '') {
  const text = typeof message === 'string' ? message.trim() : '';
  return text.startsWith('profile:') || text.startsWith('goal:') || text.startsWith('fact:');
}

function buildMemoriesFromRows(rows = [], fallbackMemories = {}) {
  const next = normalizeMemories(fallbackMemories);

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const message = typeof row?.message === 'string' ? row.message.trim() : '';

    if (!message || row?.role !== 'assistant' || !isExplicitMemoryMessage(message)) {
      return;
    }

    if (message.startsWith('profile:')) {
      const profile = message.slice('profile:'.length).trim();
      if (profile) {
        next.profile = profile;
      }
      return;
    }

    if (message.startsWith('goal:')) {
      const goal = message.slice('goal:'.length).trim();
      if (goal && !next.goals.includes(goal)) {
        next.goals.push(goal);
      }
      return;
    }

    if (message.startsWith('fact:')) {
      const fact = message.slice('fact:'.length).trim();
      if (fact && !next.facts.includes(fact)) {
        next.facts.push(fact);
      }
      return;
    }
  });

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
    const response = await fetch(`${SUPABASE_URL}/rest/v1/memories?select=user_id,profile,goals,facts&user_id=eq.${encodeURIComponent(userId)}`, {
      headers: getSupabaseHeaders(),
    });

    if (!response.ok) {
      return { profile: '', goals: [], facts: [] };
    }

    const rows = await response.json();
    const row = Array.isArray(rows) && rows.length ? rows[0] : null;

    if (!row) {
      return { profile: '', goals: [], facts: [] };
    }

    return {
      profile: typeof row.profile === 'string' ? row.profile.trim() : '',
      goals: Array.isArray(row.goals) ? row.goals.filter((goal) => typeof goal === 'string' && goal.trim()).map((goal) => goal.trim()) : [],
      facts: Array.isArray(row.facts) ? row.facts.filter((fact) => typeof fact === 'string' && fact.trim()).map((fact) => fact.trim()) : [],
    };
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
  const rows = [{
    user_id: userId,
    profile: normalized.profile,
    goals: normalized.goals,
    facts: normalized.facts,
  }];

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/memories?on_conflict=user_id`, {
      method: 'POST',
      headers: {
        ...getSupabaseHeaders(true, accessToken),
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(rows),
    });

    if (!response.ok) {
      console.error(await response.text());
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

function buildRequestBody(prompt, systemPrompt = '', conversationHistory = []) {
  const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  const isMemoryQuestion = /\b(benim hakkımda ne biliyorsun|what do you know about me|what do you remember about me|beni hatırlıyor musun)\b/i.test(normalizedPrompt);

  const normalizedHistory = (Array.isArray(conversationHistory) ? conversationHistory : [])
    .filter((entry) => entry && typeof entry.text === 'string' && entry.text.trim())
    .map((entry) => ({
      role: entry.role === 'assistant' ? 'assistant' : 'user',
      text: String(entry.text).trim(),
    }));

  const input = isMemoryQuestion
    ? [{ role: 'user', content: normalizedPrompt }]
    : [
        ...normalizedHistory.map((entry) => ({
          role: entry.role,
          content: entry.text,
        })),
        { role: 'user', content: normalizedPrompt },
      ];

  const shouldIncludeStructuredInput = Boolean(systemPrompt || normalizedHistory.length || isMemoryQuestion);

  if (shouldIncludeStructuredInput) {
    return {
      model: 'gpt-4.1-mini',
      instructions: systemPrompt,
      input,
      temperature: 0.7,
    };
  }

  return {
    model: 'gpt-4.1-mini',
    input: normalizedPrompt,
    temperature: 0.7,
  };
}

function extractText(payload) {
  const output = payload?.output?.[0];
  const content = output?.content?.find((item) => item?.type === 'output_text');
  return content?.text || '';
}

async function extractMemoryWithAI(userMessage) {
  const normalizedUserMessage = typeof userMessage === 'string' ? userMessage.trim() : '';
  const emptyMemory = {
    profile: '',
    goals: [],
    facts: [],
  };

  console.log("normalizedUserMessage:", normalizedUserMessage);

  if (!normalizedUserMessage) {
    return emptyMemory;
  }

  const lowerMessage = normalizedUserMessage.toLowerCase();
  const isTemporaryMessage = /\b(hello|hi|hey|good morning|good afternoon|good evening|thanks|thank you|bye|goodbye|see you|how are you|what's up|sup)\b/i.test(normalizedUserMessage)
    || /\b(what time|what's the time|current time|weather|temperature|rain|sunny|cloudy|snow|wind|forecast)\b/i.test(normalizedUserMessage)
    || /\b(today|tonight|yesterday|this morning|this afternoon|this evening|currently|right now)\b/i.test(normalizedUserMessage)
    || /\b(i ate|i drank|i watched|i played|i went|i had|i did|i am feeling|i feel|i was feeling|i had lunch|i had dinner|i had breakfast|i had pizza|i ate pizza)\b/i.test(normalizedUserMessage)
    || /\b(meal|meals|food|pizza|coffee|breakfast|lunch|dinner|snack|dessert|drink)\b/i.test(normalizedUserMessage)
    || /\b(weather|forecast|temperature|rain|sunny|cloudy|snow|wind)\b/i.test(normalizedUserMessage)
    || /\b(plan|plans|tomorrow|weekend|next week|tonight|later|this afternoon|this evening)\b/i.test(normalizedUserMessage)
    || /\b(joke|jokes|small talk|casual chat|chatting|conversation)\b/i.test(normalizedUserMessage)
    || /\?$/i.test(normalizedUserMessage);

  const hasLongTermSignal = /\b(\S+['’](da|de)\s+(yaşıyorum|çalışıyorum|okuyorum)|ben\s+.+\s+(yaşıyorum|çalışıyorum|okuyorum|oturuyorum|yaşamaktayım|yaşıyorum)|adım\s+.+|ismim\s+.+|ben\s+.+\s+doğdum|ben\s+.+\s+doğumluyum|hedefim\s+.+|amacım\s+.+|çalışıyorum|öğrenciyim|evliyim|bekarım|seviyorum|ilgileniyorum|yazılım\s+öğreniyorum|my name is|i live in|i am from|my goal is|i want to|i plan to|i am learning|i study|i use|i work as|i work at|i build|i am a|i'm a|i am an|i'm an|my occupation|my job|my hobby|my favorite|i prefer|i enjoy|i am interested in|i have been learning|i have been working on|i live in|i work in|i study in|i attend|i go to|i am based in)\b/i.test(normalizedUserMessage);

  console.log({
    hasLongTermSignal,
    isTemporaryMessage,
    lowerMessage
  });
  console.log(">>> hasLongTermSignal =", hasLongTermSignal);

  if (!hasLongTermSignal || isTemporaryMessage) {
    return emptyMemory;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        input: [
          {
            role: 'system',
            content: `
You are a long-term memory engine.

Return ONLY valid JSON.

If the user's message contains temporary information, return empty memory.

Never save greetings, thanks, jokes, weather, time, meals, today's activities, temporary plans, temporary emotions, or casual conversation.

Save ONLY information that will still matter months later.

Open and directly stated information is stored as long-term memory.
Examples:
- "Ben Antalya'da yaşıyorum" -> profile
- "Adım Mahmut" -> profile
- "Yazılım öğreniyorum" -> facts
- "Hedefim Nova AI şirketini büyütmek" -> goals

Only unclear or temporary information should return empty JSON.

Return JSON in this exact shape:
{
  "profile": "",
  "goals": [],
  "facts": []
}
`,
          },
          {
            role: 'user',
            content: normalizedUserMessage,
          },
        ],
      }),
    });

    if (!response.ok) {
      return emptyMemory;
    }

    const data = await response.json();
    const rawText = extractText(data) || '';
    console.log(JSON.stringify(data, null, 2));
    console.log('extractMemoryWithAI raw output_text:', rawText);
    const trimmedText = rawText.trim();
    console.log('extractMemoryWithAI cleaned/pre-parse text:', trimmedText);
    const cleanedText = trimmedText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let parsed = null;

    try {
      parsed = JSON.parse(cleanedText);
    } catch {
      const fallbackMatch = cleanedText.match(/\{[\s\S]*\}/);
      if (fallbackMatch) {
        try {
          parsed = JSON.parse(fallbackMatch[0]);
        } catch {
          return emptyMemory;
        }
      } else {
        return emptyMemory;
      }
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return emptyMemory;
    }

    const profile = typeof parsed.profile === 'string' ? parsed.profile.trim() : '';
    const goals = Array.isArray(parsed.goals)
      ? parsed.goals.filter((goal) => typeof goal === 'string' && goal.trim()).map((goal) => goal.trim())
      : [];
    const facts = Array.isArray(parsed.facts)
      ? parsed.facts.filter((fact) => typeof fact === 'string' && fact.trim()).map((fact) => fact.trim())
      : [];

    const temporaryFactPattern = /\b(food|meal|meals|pizza|hamburger|lahmacun|kebab|baklava|kokoreç|breakfast|lunch|dinner|snack|dessert|coffee|tea|weather|today|yesterday|tomorrow|forecast|temperature|rain|sunny|cloudy|snow|wind|tonight|this morning|this afternoon|this evening|currently|right now|weekend|next week|later|temporary|plan|plans|emotion|feeling|felt|mood|joke|jokes|small talk|casual chat|greeting|hello|hi|thanks|thank you)\b/i;

    const filteredGoals = goals.filter((goal) => !temporaryFactPattern.test(goal));
    const filteredFacts = facts.filter((fact) => !temporaryFactPattern.test(fact));

    const hasTemporaryContent = [profile, ...filteredGoals, ...filteredFacts].some((value) => temporaryFactPattern.test(value));

    if (!profile && filteredGoals.length === 0 && filteredFacts.length === 0) {
      return emptyMemory;
    }

    if (hasTemporaryContent) {
      return emptyMemory;
    }

    console.log("=== EXTRACTED MEMORY ===");
    console.log({
      profile,
      goals: filteredGoals,
      facts: filteredFacts,
    });
    console.log("========================");
    console.log("PROFILE =", profile);

    return {
      profile,
      goals: filteredGoals,
      facts: filteredFacts,
    };
  } catch {
    return emptyMemory;
  }
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

module.exports = {
  app,
  buildRequestBody,
  extractText,
  serializeMemoryForSupabase,
  parseMemoryPayload,
  buildMemoriesFromRows,
  saveMemories,
  extractMemoryWithAI,
  };