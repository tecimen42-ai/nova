import test from 'node:test';
import assert from 'node:assert/strict';
import { getStorageKey, normalizeRoute } from '../auth.mjs';

test('getStorageKey keeps the legacy storage key for anonymous sessions', () => {
  assert.equal(getStorageKey('nova-chats', null), 'nova-chats');
  assert.equal(getStorageKey('nova-memories', ''), 'nova-memories');
});

test('getStorageKey scopes storage to a user id when one is available', () => {
  assert.equal(getStorageKey('nova-chats', 'user-42'), 'nova-chats:user-42');
  assert.equal(getStorageKey('nova-memories', 'user-42'), 'nova-memories:user-42');
});

test('normalizeRoute maps login, register, reset and chat hashes to stable values', () => {
  assert.equal(normalizeRoute('#/login'), 'login');
  assert.equal(normalizeRoute('#/register'), 'register');
  assert.equal(normalizeRoute('#/reset'), 'reset');
  assert.equal(normalizeRoute('#/chat'), 'chat');
  assert.equal(normalizeRoute(''), 'login');
});
