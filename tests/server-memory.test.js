const test = require('node:test');
const assert = require('node:assert/strict');
const { serializeMemoryForSupabase, parseMemoryPayload, buildMemoriesFromRows, saveMemories } = require('../server.js');

test('serializeMemoryForSupabase and parseMemoryPayload round-trip memory data', () => {
  const memories = {
    profile: 'Yaratıcı marka yöneticisi',
    goals: ['Premium marka mesajları geliştirmek'],
    facts: ['İstanbul merkezli']
  };

  const serialized = serializeMemoryForSupabase(memories);
  const restored = parseMemoryPayload(serialized);

  assert.equal(restored.profile, 'Yaratıcı marka yöneticisi');
  assert.deepEqual(restored.goals, ['Premium marka mesajları geliştirmek']);
  assert.deepEqual(restored.facts, ['İstanbul merkezli']);
});

test('buildMemoriesFromRows reconstructs profile, goals, and facts from prior conversation messages', () => {
const memories = buildMemoriesFromRows([
  {
    role: 'assistant',
    message: 'profile:Ada'
  },
  {
    role: 'assistant',
    message: 'goal:launch a new app'
  },
  {
    role: 'assistant',
    message: 'fact:lives in Istanbul'
  },
]);

  assert.equal(memories.profile, 'Ada');
  assert.deepEqual(memories.goals, ['launch a new app']);
  assert.deepEqual(memories.facts, ['lives in Istanbul']);
});

test('saveMemories writes the profile row so later loads can restore it', async () => {
  const originalFetch = global.fetch;
  let postedPayload = null;
  const calls = [];

  global.fetch = async (_url, options) => {
    calls.push(options);
    return {
      ok: true,
      text: async () => '',
      json: async () => [],
      status: 200,
      statusText: 'OK',
    };
  };

  try {
    await saveMemories({ profile: 'Mahmut', goals: ['launch a new app'], facts: ['lives in Istanbul'] }, 'user-123');

    postedPayload = JSON.parse(calls[0]?.body || '[]');
  } finally {
    global.fetch = originalFetch;
  }

  assert.ok(postedPayload, 'Expected a payload to be posted to Supabase.');
  assert.equal(postedPayload[0]?.profile, 'Mahmut');
  assert.deepEqual(postedPayload[0]?.goals, ['launch a new app']);
  assert.deepEqual(postedPayload[0]?.facts, ['lives in Istanbul']);
});

test('saveMemories uses an access token passed from the request when available', async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (_url, options) => {
    calls.push(options);
    return {
      ok: true,
      text: async () => '',
      json: async () => [],
      status: 200,
      statusText: 'OK',
    };
  };

  try {
    await saveMemories({ profile: 'Mahmut' }, 'user-123', 'user-access-token');
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(calls[0]?.headers?.Authorization, 'Bearer user-access-token');
});
