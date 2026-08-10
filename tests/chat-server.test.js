const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRequestBody, extractText } = require('../server');

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

test('extractText reads content from the Responses API output structure', () => {
  const reply = extractText({
    output: [
      {
        content: [{ type: 'output_text', text: 'Hello from the assistant' }],
      },
    ],
  });

  assert.equal(reply, 'Hello from the assistant');
});
