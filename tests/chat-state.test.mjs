import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMemoryPrompt, createNewChatState, loadChatsFromStorage, loadMemories, renderChatList, renderMarkdown, saveChatsToStorage, saveMemories, selectChat, updateMemoriesFromConversation } from '../chatState.mjs';

test('createNewChatState creates a new active chat and keeps existing ones', () => {
  const initialChats = [{ id: 'chat-1', title: 'Marka stratejisi', messages: [] }];

  const result = createNewChatState(initialChats, 'chat-1', 'Yeni sohbet');

  assert.equal(result.chats.length, 2);
  assert.equal(result.activeChatId, result.chats[0].id);
  assert.equal(result.chats[0].title, 'Yeni sohbet');
});

test('renderChatList marks the active chat and includes chat titles', () => {
  const chats = [
    { id: 'chat-1', title: 'Marka stratejisi', messages: [] },
    { id: 'chat-2', title: 'Ana sayfa fikirleri', messages: [] },
  ];

  const html = renderChatList(chats, 'chat-2');

  assert.match(html, /Ana sayfa fikirleri/);
  assert.match(html, /class="history-item active"/);
  assert.match(html, /data-chat-id="chat-2"/);
});

test('selectChat keeps the current chat when the requested one does not exist', () => {
  const chats = [
    { id: 'chat-1', title: 'Marka stratejisi', messages: [] },
    { id: 'chat-2', title: 'Ana sayfa fikirleri', messages: [] },
  ];

  assert.equal(selectChat(chats, 'chat-1', 'chat-2'), 'chat-2');
  assert.equal(selectChat(chats, 'chat-1', 'chat-3'), 'chat-1');
});

test('loadChatsFromStorage and saveChatsToStorage round-trip chats', () => {
  const storage = {
    data: {},
    getItem(key) {
      return this.data[key] ?? null;
    },
    setItem(key, value) {
      this.data[key] = value;
    },
  };

  const chats = [{ id: 'chat-1', title: 'Marka stratejisi', messages: [{ role: 'user', text: 'Merhaba' }] }];

  saveChatsToStorage(storage, chats, 'chat-1');
  const restored = loadChatsFromStorage(storage, []);

  assert.equal(restored.activeChatId, 'chat-1');
  assert.equal(restored.chats[0].messages[0].text, 'Merhaba');
});

test('renderMarkdown supports headings, lists, bold text, and code blocks', () => {
  const html = renderMarkdown('# Başlık\n\n- item 1\n- item 2\n\n**kalın** text\n\n```js\nconst value = 1;\n```');

  assert.match(html, /<h1>Başlık<\/h1>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<li>item 1<\/li>/);
  assert.match(html, /<strong>kalın<\/strong>/);
  assert.match(html, /<pre><code class="language-js">/);
});

test('loadMemories and saveMemories round-trip JSON memories', () => {
  const storage = {
    data: {},
    getItem(key) {
      return this.data[key] ?? null;
    },
    setItem(key, value) {
      this.data[key] = value;
    },
  };

  const memories = {
    profile: 'Yaratıcı marka yöneticisi',
    goals: ['Premium marka mesajları geliştirmek'],
    facts: ['Kullanıcı İstanbul merkezli'],
  };

  saveMemories(storage, memories);
  const restored = loadMemories(storage);

  assert.equal(restored.profile, 'Yaratıcı marka yöneticisi');
  assert.equal(restored.goals[0], 'Premium marka mesajları geliştirmek');
  assert.equal(restored.facts[0], 'Kullanıcı İstanbul merkezli');
});

test('buildMemoryPrompt includes stored memory and answers self-questions from it', () => {
  const prompt = buildMemoryPrompt('What do you remember about me?', {
    profile: 'Yaratıcı marka yöneticisi',
    goals: ['Premium marka mesajları geliştirmek'],
    facts: ['İstanbul merkezli'],
  });

  assert.match(prompt, /User profile:/);
  assert.match(prompt, /Premium marka mesajları geliştirmek/);
  assert.match(prompt, /İstanbul merkezli/);
  assert.match(prompt, /answer only from the stored memory/i);
});

test('updateMemoriesFromConversation adds new goals and facts', () => {
  const nextMemories = updateMemoriesFromConversation({ profile: '', goals: [], facts: [] }, 'My goal is to launch Nova AI.', 'Great plan.');

  assert.equal(nextMemories.profile, '');
  assert.deepEqual(nextMemories.goals, ['to launch Nova AI']);
});
