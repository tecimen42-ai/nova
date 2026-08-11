const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRequestBody, extractText, extractMemoryWithAI } = require('../server');

function mockOpenAIResponse(payloadText) {
  return {
    ok: true,
    json: async () => ({
      output: [
        {
          content: [{ type: 'output_text', text: payloadText }],
        },
      ],
    }),
  };
}

test('buildRequestBody sends the prompt in the expected Responses API shape', () => {
  const body = buildRequestBody('Hello there');

  assert.equal(body.model, 'gpt-4.1-mini');
  assert.equal(body.input, 'Hello there');
  assert.equal(body.temperature, 0.7);
});

test('buildRequestBody sends system and user input when a system prompt is provided', () => {
  const body = buildRequestBody('Hello there', 'User profile: Product designer');

  assert.equal(body.instructions, 'User profile: Product designer');
  assert.equal(body.input[0].role, 'user');
  assert.equal(body.input[0].content, 'Hello there');
});

test('buildRequestBody includes recent conversation history before the latest prompt', () => {
  const body = buildRequestBody('How are you?', 'You are a helpful assistant.', [
    { role: 'user', text: 'My name is Ada' },
    { role: 'assistant', text: 'Nice to meet you, Ada.' },
  ]);

  assert.equal(body.instructions, 'You are a helpful assistant.');
  assert.equal(body.input[0].role, 'user');
  assert.equal(body.input[0].content, 'My name is Ada');
  assert.equal(body.input[1].role, 'assistant');
  assert.equal(body.input[1].content, 'Nice to meet you, Ada.');
  assert.equal(body.input[2].role, 'user');
  assert.equal(body.input[2].content, 'How are you?');
});
test('extractMemoryWithAI stores a profile when the user states where they live', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    mockOpenAIResponse('{"profile":"Antalya\'da yaşıyorum","goals":[],"facts":[]}');

  try {
    const result = await extractMemoryWithAI("Antalya'da yaşıyorum.");
    assert.deepEqual(result, {
      profile: "Antalya'da yaşıyorum",
      goals: [],
      facts: [],
    });
  } finally {
    global.fetch = originalFetch;
  }
});


test('extractMemoryWithAI stores a fact when the user says they are learning something', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => mockOpenAIResponse('{"profile":"","goals":[],"facts":["Yazılım öğreniyorum"]}');

  try {
    const result = await extractMemoryWithAI('Yazılım öğreniyorum.');
    assert.deepEqual(result.facts, ['Yazılım öğreniyorum']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('extractMemoryWithAI stores a goal when the user states a long-term objective', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => mockOpenAIResponse('{"profile":"","goals":["Nova AI şirketini büyütmek"],"facts":[]}');

  try {
    const result = await extractMemoryWithAI('Hedefim Nova AI şirketini büyütmek.');
    assert.deepEqual(result.goals, ['Nova AI şirketini büyütmek']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('extractMemoryWithAI returns empty memory for temporary events', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => mockOpenAIResponse('{"profile":"","goals":[],"facts":["Bugün pizza yedim"]}');

  try {
    const result = await extractMemoryWithAI('Bugün pizza yedim.');
    assert.deepEqual(result, { profile: '', goals: [], facts: [] });
  } finally {
    global.fetch = originalFetch;
  }
});

test('extractMemoryWithAI returns empty memory for greetings', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => mockOpenAIResponse('{"profile":"","goals":[],"facts":[]}');

  try {
    const result = await extractMemoryWithAI('Merhaba nasılsın?');
    assert.deepEqual(result, { profile: '', goals: [], facts: [] });
  } finally {
    global.fetch = originalFetch;
  }
});
