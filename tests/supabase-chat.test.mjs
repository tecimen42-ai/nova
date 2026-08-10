import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSupabaseMessages } from '../supabaseChat.mjs';

test('normalizeSupabaseMessages maps the Supabase payload to the chat message format', () => {
  const rows = [
    { id: '1', role: 'user', message: 'Merhaba', created_at: '2024-01-01T00:00:00Z' },
    { id: '2', role: 'assistant', message: 'Merhaba!', created_at: '2024-01-01T00:01:00Z' },
  ];

  const normalized = normalizeSupabaseMessages(rows);

  assert.equal(normalized[0].role, 'user');
  assert.equal(normalized[0].text, 'Merhaba');
  assert.equal(normalized[1].role, 'assistant');
  assert.equal(normalized[1].text, 'Merhaba!');
});
