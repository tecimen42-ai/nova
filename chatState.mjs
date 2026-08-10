function generateChatId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createNewChatState(chats, activeChatIdOrTitle = 'Yeni sohbet', title = 'Yeni sohbet') {
  const resolvedTitle = (typeof title === 'string' && title.trim())
    ? title
    : (typeof activeChatIdOrTitle === 'string' && activeChatIdOrTitle.trim()
      ? activeChatIdOrTitle
      : 'Yeni sohbet');

  const nextChat = {
    id: generateChatId(),
    title: resolvedTitle.trim() || 'Yeni sohbet',
    messages: [],
  };

  const nextChats = [nextChat, ...chats.filter((chat) => chat.id !== nextChat.id)];

  return {
    chats: nextChats,
    activeChatId: nextChat.id,
  };
}

export function updateChatTitle(chats, activeChatId, title) {
  const normalizedTitle = title.trim() || 'Yeni sohbet';

  return chats.map((chat) => {
    if (chat.id !== activeChatId) {
      return chat;
    }

    return {
      ...chat,
      title: normalizedTitle,
    };
  });
}

export function selectChat(chats, activeChatId, nextChatId) {
  if (typeof nextChatId !== 'string' || !nextChatId.trim()) {
    return activeChatId;
  }

  return chats.some((chat) => chat.id === nextChatId) ? nextChatId : activeChatId;
}

function getStorageKey(baseKey, userId = '') {
  const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
  return normalizedUserId ? `${baseKey}:${normalizedUserId}` : baseKey;
}

export function saveChatsToStorage(storage, chats, activeChatId, userId = '') {
  if (!storage || typeof storage.setItem !== 'function') {
    return;
  }

  const payload = JSON.stringify({ chats, activeChatId });
  storage.setItem(getStorageKey('nova-chats', userId), payload);
}

export function normalizeMemories(memories = {}) {
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

export function saveMemories(storage, memories = {}, userId = '') {
  if (!storage || typeof storage.setItem !== 'function') {
    return;
  }

  storage.setItem(getStorageKey('nova-memories', userId), JSON.stringify(normalizeMemories(memories)));
}

export function loadMemories(storage, fallbackMemories = {}, userId = '') {
  if (!storage || typeof storage.getItem !== 'function') {
    return normalizeMemories(fallbackMemories);
  }

  const serialized = storage.getItem(getStorageKey('nova-memories', userId));
  if (!serialized) {
    return normalizeMemories(fallbackMemories);
  }

  try {
    const parsed = JSON.parse(serialized);
    return normalizeMemories(parsed);
  } catch (error) {
    return normalizeMemories(fallbackMemories);
  }
}

export function buildMemorySystemPrompt(memories = {}) {
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

export function buildMemoryPrompt(userPrompt, memories = {}) {
  const systemPrompt = buildMemorySystemPrompt(memories);
  const lowerPrompt = String(userPrompt || '').toLowerCase();
  const asksAboutSelf = /(my|me|myself|remember|memory|name|goal|project|profile)/i.test(lowerPrompt);
  const instruction = asksAboutSelf
    ? 'Answer only from the stored memory and do not invent details.'
    : 'Use the stored memory as context when relevant.';

  return `System:\n${systemPrompt}\n\n${instruction}\n\nUser message:\n${String(userPrompt || '').trim()}`;
}

export function updateMemoriesFromConversation(memories = {}, userPrompt = '', assistantReply = '') {
  const normalized = normalizeMemories(memories);
  const next = {
    profile: normalized.profile,
    goals: [...normalized.goals],
    facts: [...normalized.facts],
  };

  const text = `${String(userPrompt || '')}\n${String(assistantReply || '')}`.toLowerCase();

  const profileMatch = String(userPrompt || '').match(/i am|I'm|my name is|myself|I work as|I am a|I’m a|I live in|I am from/i);
  if (profileMatch) {
    const profileLine = String(userPrompt || '').trim();
    if (profileLine && !next.profile) {
      next.profile = profileLine;
    }
  }

  const goalMatches = String(userPrompt || '').match(/my goal is (.+?)(?:\.|\n|$)/i);
  if (goalMatches?.[1]) {
    const goal = goalMatches[1].trim();
    if (!next.goals.includes(goal)) {
      next.goals.push(goal);
    }
  }

  const factMatches = String(userPrompt || '').match(/(my|i) (?:favorite|work|live|study|use|build|want|need|have) (.+?)(?:\.|\n|$)/i);
  if (factMatches?.[2]) {
    const fact = factMatches[2].trim();
    if (!next.facts.includes(fact)) {
      next.facts.push(fact);
    }
  }

  if (/(goal|goals|project|remember|memory|profile|facts)/i.test(text)) {
    const remembered = String(userPrompt || '').trim();
    if (remembered && !next.facts.includes(remembered)) {
      next.facts.push(remembered);
    }
  }

  return next;
}

export function loadChatsFromStorage(storage, fallbackChats = [], userId = '') {
  if (!storage || typeof storage.getItem !== 'function') {
    return { chats: fallbackChats, activeChatId: fallbackChats[0]?.id || null };
  }

  const serialized = storage.getItem(getStorageKey('nova-chats', userId));
  if (!serialized) {
    return { chats: fallbackChats, activeChatId: fallbackChats[0]?.id || null };
  }

  try {
    const parsed = JSON.parse(serialized);
    const chats = Array.isArray(parsed?.chats) ? parsed.chats : fallbackChats;
    const activeChatId = typeof parsed?.activeChatId === 'string' ? parsed.activeChatId : chats[0]?.id || null;

    return { chats, activeChatId };
  } catch (error) {
    return { chats: fallbackChats, activeChatId: fallbackChats[0]?.id || null };
  }
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInlineMarkdown(text) {
  const escaped = escapeHtml(text);
  const withStrong = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/__(.+?)__/g, '<strong>$1</strong>');
  const withEmphasis = withStrong.replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/_(.+?)_/g, '<em>$1</em>');

  return withEmphasis.replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function renderMarkdown(text = '') {
  const normalized = String(text ?? '').replace(/\r\n/g, '\n');
  const blocks = normalized.split(/\n{2,}/).filter((block) => block.trim());

  return blocks.map((block) => {
    const trimmed = block.trim();

    if (/^```/.test(trimmed)) {
      const match = trimmed.match(/^```([\w-]*)\s*\n([\s\S]*?)\s*```$/);
      if (match) {
        const language = match[1] ? ` class="language-${escapeHtml(match[1])}"` : '';
        const code = escapeHtml(match[2]);
        return `<pre><code${language}>${code}</code><button class="copy-code" type="button">Kopyala</button></pre>`;
      }
    }

    if (/^#{1,3}\s/.test(trimmed)) {
      const level = trimmed.match(/^(#{1,3})/)[1].length;
      const content = renderInlineMarkdown(trimmed.replace(/^#{1,3}\s/, ''));
      return `<h${level}>${content}</h${level}>`;
    }

    if (/^(-|\d+\.)\s/.test(trimmed)) {
      const listItems = trimmed
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          const item = line.replace(/^(-|\d+\.)\s/, '').trim();
          return `<li>${renderInlineMarkdown(item)}</li>`;
        })
        .join('');

      const isOrdered = /^\d+\./.test(trimmed.split('\n')[0]);
      return `<${isOrdered ? 'ol' : 'ul'}>${listItems}</${isOrdered ? 'ol' : 'ul'}>`;
    }

    return `<p>${renderInlineMarkdown(trimmed)}</p>`;
  }).join('');
}

export function renderChatList(chats, activeChatId) {
  if (!Array.isArray(chats) || chats.length === 0) {
    return '<div class="history-empty">Henüz sohbet yok.</div>';
  }

  return chats
    .map((chat) => {
      const isActive = chat.id === activeChatId;
      const activeClass = isActive ? ' active' : '';
      return `<button class="history-item${activeClass}" type="button" data-chat-id="${chat.id}">${chat.title}</button>`;
    })
    .join('');
}
