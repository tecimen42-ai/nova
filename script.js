import { createNewChatState as createNewChatStateHelper, loadChatsFromStorage, loadMemories, renderChatList as renderChatListHelper, renderMarkdown, saveChatsToStorage, saveMemories, selectChat as selectChatId, updateChatTitle } from './chatState.mjs';
import { auth, normalizeRoute } from './auth.mjs';
import { normalizeSupabaseMessages } from './supabaseChat.mjs';
import { applyMemoryStateToFields } from './memoryUi.mjs';

const appRoot = typeof document !== 'undefined' ? document.getElementById('appRoot') : null;

const defaultChats = [
  { id: 'chat-1', title: 'Marka stratejisi', messages: [] },
  { id: 'chat-2', title: 'Ana sayfa fikirleri', messages: [] },
  { id: 'chat-3', title: 'Ürün lansman metni', messages: [] },
];

let chats = defaultChats;
let activeChatId = defaultChats[0].id;
let currentRoute = 'chat';
let currentAuthState = null;
let chatShell = null;
let memoryProfile = null;
let memoryGoals = null;
let memoryFacts = null;
let memoryState = {
  profile: '',
  goals: [],
  facts: [],
};

function getFallbackUserId() {
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    const stored = window.localStorage.getItem('nova-demo-user-id');
    if (stored) {
      return stored;
    }
  }

  return '8d57dfad-e43d-44e8-b29a-e582da737a9e';
}

function getCurrentUserId() {
  return currentAuthState?.user?.id || auth.getUser?.()?.id || getFallbackUserId();
}

async function getCurrentUserIdAsync() {
  const directUserId = getCurrentUserId();
  if (directUserId) {
    return directUserId;
  }

  const client = auth.getClient?.();
  if (!client?.auth?.getUser) {
    return '';
  }

  try {
    const { data } = await client.auth.getUser();
    return data?.user?.id || '';
  } catch (error) {
    console.error('Failed to resolve current user id for memory loading.', error);
    return '';
  }
}

function getSupabaseClient() {
  return auth.getClient?.() || null;
}

function loadChats() {
  const restored = loadChatsFromStorage({ getItem: (key) => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) }, defaultChats, currentAuthState?.user?.id || '');
  chats = restored.chats;
  activeChatId = restored.activeChatId || chats[0]?.id || defaultChats[0].id;
  renderChatList();
  renderActiveChatMessages();
}

function saveChats() {
  saveChatsToStorage({ getItem: (key) => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) }, chats, activeChatId, currentAuthState?.user?.id || '');
}

function normalizeMemoryDisplayValue(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/^(profile|goal|fact):\s*/i, '').trim();
}

function renderMemoryPanel() {
  const profileField = memoryProfile || (typeof document !== 'undefined' ? document.getElementById('memoryProfile') : null);
  const goalsField = memoryGoals || (typeof document !== 'undefined' ? document.getElementById('memoryGoals') : null);
  const factsField = memoryFacts || (typeof document !== 'undefined' ? document.getElementById('memoryFacts') : null);

  if (profileField) {
    memoryProfile = profileField;
  }

  if (goalsField) {
    memoryGoals = goalsField;
  }

  if (factsField) {
    memoryFacts = factsField;
  }

  const profileValue = typeof memoryState?.profile === 'string' ? memoryState.profile : '';
  const goalsValue = Array.isArray(memoryState?.goals)
    ? memoryState.goals.map((goal) => normalizeMemoryDisplayValue(goal)).filter(Boolean).join('\n')
    : '';
  const factsValue = Array.isArray(memoryState?.facts)
    ? memoryState.facts.map((fact) => normalizeMemoryDisplayValue(fact)).filter(Boolean).join('\n')
    : '';

  if (memoryProfile) {
    memoryProfile.value = profileValue;
  }

  if (memoryGoals) {
    memoryGoals.value = goalsValue;
  }

  if (memoryFacts) {
    memoryFacts.value = factsValue;
  }

  applyMemoryStateToFields({
    profile: profileValue,
    goals: Array.isArray(memoryState?.goals) ? memoryState.goals : [],
    facts: Array.isArray(memoryState?.facts) ? memoryState.facts : [],
  }, {
    profile: memoryProfile,
    goals: memoryGoals,
    facts: memoryFacts,
  });
}

function setMemoryState(profile = '', goals = [], facts = []) {
  memoryState = {
    profile: typeof profile === 'string' ? profile : '',
    goals: Array.isArray(goals) ? goals : [],
    facts: Array.isArray(facts) ? facts : [],
  };

  renderMemoryPanel();
}

async function loadMemoriesIntoUI() {
  const userId = await getCurrentUserIdAsync();
  if (!userId) {
    setMemoryState('', [], []);
    return;
  }

  try {
    const response = await fetch(`/api/memories?userId=${encodeURIComponent(userId)}`);
    if (!response.ok) {
      throw new Error('Failed to load memories');
    }

    const data = await response.json();
    console.log("=== API RESPONSE ===");
    console.log(data);
    console.log("====================");
    setMemoryState(data.profile || '', data.goals || [], data.facts || []);
    console.log("=== MEMORY STATE SET ===");
    console.log(memoryState);
    console.log("========================");
  } catch (error) {
    console.error('Failed to load memory data.', error);
    setMemoryState('', [], []);
  }
}

async function refreshMemoryPanel() {
  await loadMemoriesIntoUI();
  renderMemoryPanel();

  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => {
      renderMemoryPanel();
    });
  }
}

function saveMemoriesFromUI() {
  const memories = {
    profile: memoryProfile?.value?.trim() || '',
    goals: (memoryGoals?.value || '').split(/\n+/).map((goal) => goal.trim()).filter(Boolean),
    facts: (memoryFacts?.value || '').split(/\n+/).map((fact) => fact.trim()).filter(Boolean),
  };

  saveMemories({ getItem: (key) => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) }, memories, currentAuthState?.user?.id || '');
}

async function loadMessagesFromSupabase() {
  const userId = getCurrentUserId();
  const client = getSupabaseClient();
  if (!client || !userId) {
    return [];
  }

  const { data, error } = await client
    .from('messages')
    .select('id, user_id, role, message, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to load Supabase messages.', error);
    return [];
  }

  const nextMessages = normalizeSupabaseMessages(data || []);
  if (!nextMessages.length) {
    return [];
  }

  const targetChatId = activeChatId || chats[0]?.id || 'chat-supabase';
  const existingChat = chats.find((chat) => chat.id === targetChatId);
  const nextChats = existingChat
    ? chats.map((chat) => (chat.id === targetChatId ? { ...chat, messages: nextMessages } : chat))
    : [{ id: targetChatId, title: 'Sohbet', messages: nextMessages }, ...chats];

  chats = nextChats;
  activeChatId = targetChatId;
  renderChatList();
  renderActiveChatMessages();

  return nextMessages;
}

async function saveMessageToSupabase(role, message) {
  const userId = getCurrentUserId();
  const client = getSupabaseClient();
  if (!client || !userId) {
    return null;
  }

  const { data, error } = await client
    .from('messages')
    .insert({ user_id: userId, role, message })
    .select('id, user_id, role, message, created_at')
    .single();

  if (error) {
    console.error('Failed to save message to Supabase.', error);
    return null;
  }

  return data;
}

function isInternalMemoryMessage(text = '') {
  const normalized = String(text || '').trim();
  return /^(profile|goal|fact):/i.test(normalized);
}

function renderActiveChatMessages() {
  if (!chatShell) return;
  const messages = chatShell.querySelector('#messages');
  const activeChat = chats.find((chat) => chat.id === activeChatId);
  if (!activeChat) {
    messages.innerHTML = '';
    renderWelcomeCard(messages);
    return;
  }

  messages.innerHTML = '';

  const visibleMessages = (activeChat.messages || []).filter((message) => !isInternalMemoryMessage(message?.text));

  if (visibleMessages.length === 0) {
    renderWelcomeCard(messages);
    return;
  }

  visibleMessages.forEach((message) => {
    createMessage(messages, message.role, message.text);
  });
}

function selectChat(chatId) {
  const nextActiveChatId = selectChatId(chats, activeChatId, chatId);
  if (!nextActiveChatId) return;

  activeChatId = nextActiveChatId;
  renderActiveChatMessages();
  renderChatList();
  saveChats();
}

function renderChatList() {
  if (!chatShell) return;
  const chatList = chatShell.querySelector('.history');
  if (!chatList) return;

  chatList.innerHTML = renderChatListHelper(chats, activeChatId);
  chatList.querySelectorAll('.history-item').forEach((item) => {
    item.addEventListener('click', () => selectChat(item.dataset.chatId));
  });
}

function createNewChat() {
  const newChatState = createNewChatStateHelper(chats, 'Yeni sohbet');
  chats = newChatState.chats;
  activeChatId = newChatState.activeChatId;
  const messages = chatShell?.querySelector('#messages');
  if (messages) {
    messages.innerHTML = '';
    renderWelcomeCard(messages);
  }
  renderChatList();
  saveChats();
  void refreshMemoryPanel();
}

function renderWelcomeCard(messages) {
  if (!messages) return;
  messages.innerHTML = `
    <div class="welcome-card">
      <div class="welcome-hero">
        <div class="welcome-badge">Nova AI</div>
        <p class="eyebrow">Hazır ve premium deneyim</p>
        <h3>Görsel dil, metin ve stratejiyi aynı anda şekillendirelim.</h3>
        <p>Marka mesajlarından kullanıcı akışına kadar her şeyi net, zarif ve hızlı bir biçimde hazırlayabilirim.</p>
      </div>
      <div class="prompt-chips">
        <button class="chip" data-prompt="Bir premium marka için etkileyici bir lansman mesajı yaz." type="button">Lansman metni</button>
        <button class="chip" data-prompt="Modern bir yaratıcı stüdyo için ana sayfa düzeni öner." type="button">Ana sayfa düzeni</button>
        <button class="chip" data-prompt="Yeni bir yapay zeka ürününün kısa ve güçlü bir tanıtımını hazırla." type="button">Ürün tanıtımı</button>
      </div>
    </div>
  `;

  messages.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => sendMessage(chip.dataset.prompt));
  });
}

function createMessage(messages, role, text) {
  if (isInternalMemoryMessage(text)) {
    return;
  }

  const row = document.createElement('div');
  row.className = `message-row ${role}`;

  const bubble = document.createElement('div');
  bubble.className = `bubble ${role}`;
  bubble.innerHTML = role === 'assistant' ? renderMarkdown(text) : `<p>${text}</p>`;

  if (role === 'assistant') {
    bubble.querySelectorAll('.copy-code').forEach((button) => {
      button.addEventListener('click', async () => {
        const code = button.previousElementSibling?.textContent || '';
        await navigator.clipboard.writeText(code);
        button.textContent = 'Kopyalandı';
        setTimeout(() => {
          button.textContent = 'Kopyala';
        }, 1500);
      });
    });
  }

  row.appendChild(bubble);
  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;
}

function syncActiveChatMessages() {
  if (!chatShell) return;
  const messages = chatShell.querySelector('#messages');
  const activeChat = chats.find((chat) => chat.id === activeChatId);
  if (!activeChat || !messages) return;

  activeChat.messages = Array.from(messages.querySelectorAll('.message-row')).map((row) => ({
    role: row.classList.contains('user') ? 'user' : 'assistant',
    text: Array.from(row.querySelectorAll('p, h1, h2, h3, li, pre, code')).map((node) => node.textContent).join('\n').trim() || '',
  }));

  saveChats();
}

async function sendMessage(text) {
  if (!chatShell) return;
  const value = String(text || '').trim();
  if (!value) return;

  const messages = chatShell.querySelector('#messages');
  const input = chatShell.querySelector('#promptInput');
  if (!messages || !input) return;

  if (messages.querySelector('.welcome-card')) {
    messages.innerHTML = '';
  }

  const currentChat = chats.find((chat) => chat.id === activeChatId);
  if (!currentChat) return;

  if (getCurrentUserId()) {
    await saveMessageToSupabase('user', value);
  }

  createMessage(messages, 'user', value);
  input.value = '';
  syncActiveChatMessages();

  const typing = document.createElement('div');
  typing.className = 'message-row assistant';
  typing.innerHTML = '<div class="bubble assistant typing"><span></span><span></span><span></span></div>';
  messages.appendChild(typing);
  messages.scrollTop = messages.scrollHeight;

  try {
    const requestUserId = getCurrentUserId();
    console.log('[chat] sending request', { userId: requestUserId, message: value });
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: value, userId: requestUserId }),
    });

    const data = await response.json();

    typing.remove();

    if (!response.ok) {
      createMessage(messages, 'assistant', data.error || 'Asistan şu anda yanıt veremiyor.');
      return;
    }

    const reply = data.reply || 'Yanıt dönmedi.';
    if (getCurrentUserId()) {
      await saveMessageToSupabase('assistant', reply);
    }

    createMessage(messages, 'assistant', reply);
    syncActiveChatMessages();
    const nextChats = updateChatTitle(chats, activeChatId, currentChat.title);
    chats = nextChats;

    await loadMemoriesIntoUI();
    renderMemoryPanel();

    renderChatList();
    saveChats();
  } catch (error) {
    typing.remove();
    createMessage(messages, 'assistant', 'Asistanla bağlantı kurulamadı. Lütfen tekrar dene.');
    syncActiveChatMessages();
  }
}

async function renderChatShell() {
  if (!appRoot) return;

  chatShell = document.createElement('div');
  chatShell.className = 'app-shell';
  chatShell.innerHTML = `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">N</div>
        <div>
          <h1>Nova AI</h1>
          <p>Premium asistan</p>
        </div>
      </div>

      <button class="new-chat" id="newChatBtn" type="button">
        <span>+</span> Yeni sohbet
      </button>

      <div class="history"></div>

      <div class="memory-panel">
        <div class="memory-panel-header">
          <strong>Long-term memory</strong>
          <span>Özet</span>
        </div>
        <label class="memory-field">
          <span>Profil</span>
          <textarea id="memoryProfile" rows="3" placeholder="Kullanıcı profili"></textarea>
        </label>
        <label class="memory-field">
          <span>Hedefler</span>
          <textarea id="memoryGoals" rows="3" placeholder="Hedefler (satır satır)"></textarea>
        </label>
        <label class="memory-field">
          <span>Önemli gerçekler</span>
          <textarea id="memoryFacts" rows="3" placeholder="Önemli gerçekler (satır satır)"></textarea>
        </label>
      </div>

      <div class="sidebar-footer">
        <div class="avatar">AI</div>
        <div>
          <strong>Nova Studio</strong>
          <p>7/24 hazır</p>
        </div>
      </div>
    </aside>

    <main class="chat-pane">
      <header class="chat-header">
        <div>
          <p class="eyebrow">Yapay zekâ asistanı</p>
          <h2>Ne üretmek istersin?</h2>
        </div>
        <div class="header-actions">
          <button class="icon-btn" type="button">⚡</button>
          <button class="icon-btn" type="button" id="logoutBtn">↺</button>
        </div>
      </header>

      <section class="messages" id="messages"></section>

      <div class="composer">
        <div class="composer-box">
          <textarea id="promptInput" placeholder="Nova AI'ya bir şey sor..."></textarea>
          <button id="sendBtn" type="button">Gönder</button>
        </div>
        <div class="prompt-chips compact">
          <button class="chip" data-prompt="Bu sayfayı tek cümlede özetle." type="button">Özetle</button>
          <button class="chip" data-prompt="Üç modern ana sayfa hero fikri öner." type="button">Hero fikirleri</button>
          <button class="chip" data-prompt="Bu ürün mesajını daha etkileyici hale getir." type="button">Mesajlandırma</button>
        </div>
      </div>
    </main>
  `;

  appRoot.innerHTML = '';
  appRoot.appendChild(chatShell);

  console.log("=== SIDEBAR HTML ===");
  console.log(document.querySelector(".sidebar"));
  console.log("====================");

  memoryProfile = chatShell.querySelector('#memoryProfile');
  memoryGoals = chatShell.querySelector('#memoryGoals');
  memoryFacts = chatShell.querySelector('#memoryFacts');
  const input = chatShell.querySelector('#promptInput');
  const sendBtn = chatShell.querySelector('#sendBtn');
  const newChatBtn = chatShell.querySelector('#newChatBtn');
  const logoutBtn = chatShell.querySelector('#logoutBtn');

  if (sendBtn) {
    sendBtn.addEventListener('click', () => sendMessage(input.value));
  }

  if (input) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage(input.value);
      }
    });
  }

  if (newChatBtn) {
    newChatBtn.addEventListener('click', createNewChat);
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await auth.signOut();
      renderRoute();
    });
  }

  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => sendMessage(chip.dataset.prompt));
  });

  loadChats();
  await refreshMemoryPanel();
  await loadMessagesFromSupabase();

  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => {
      renderMemoryPanel();
    });
  }

  [memoryProfile, memoryGoals, memoryFacts].forEach((field) => {
    if (!field) return;
    field.addEventListener('input', saveMemoriesFromUI);
  });

  if (memoryProfile && memoryGoals && memoryFacts) {
    await refreshMemoryPanel();
  }

  renderChatList();
  renderActiveChatMessages();
}

function renderAuthScreen(mode = 'login') {
  if (!appRoot) return;

  const formMode = mode === 'register' ? 'register' : mode === 'reset' ? 'reset' : 'login';
  const title = formMode === 'register' ? 'Hesap oluştur' : formMode === 'reset' ? 'Şifre sıfırla' : 'Nova AI’ye giriş yap';
  const description = formMode === 'register'
    ? 'Hızlıca yeni bir hesap açın ve sohbetlerinizi koruyun.'
    : formMode === 'reset'
      ? 'E-posta adresinize sıfırlama bağlantısı gönderelim.'
      : 'Hesabınla devam et ve sohbetlerini koru.';
  const passwordField = formMode === 'reset'
    ? ''
    : `<label>
        Şifre
        <input type="password" id="authPassword" required />
      </label>`;

  appRoot.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <h2>${title}</h2>
        <p>${description}</p>
        <form class="auth-form" id="authForm">
          <label>
            E-posta
            <input type="email" id="authEmail" required />
          </label>
          ${passwordField}
          <div class="auth-actions">
            <button type="submit">${formMode === 'register' ? 'Kayıt ol' : formMode === 'reset' ? 'Gönder' : 'Giriş yap'}</button>
            ${formMode === 'login' ? '<button class="auth-toggle-btn" type="button" id="switchToRegister">Hesap oluştur</button>' : ''}
            ${formMode === 'login' ? '<button class="auth-link-btn" type="button" id="switchToReset">Şifremi unuttum</button>' : ''}
            ${formMode !== 'login' ? '<button class="auth-link-btn" type="button" id="switchToLogin">Girişe dön</button>' : ''}
          </div>
          <div class="auth-message" id="authMessage"></div>
        </form>
      </div>
    </div>
  `;

  const form = appRoot.querySelector('#authForm');
  const email = appRoot.querySelector('#authEmail');
  const password = appRoot.querySelector('#authPassword');
  const message = appRoot.querySelector('#authMessage');
  const switchToRegister = appRoot.querySelector('#switchToRegister');
  const switchToReset = appRoot.querySelector('#switchToReset');
  const switchToLogin = appRoot.querySelector('#switchToLogin');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const emailValue = email.value.trim();
    const passwordValue = password ? password.value : '';

    try {
      if (formMode === 'register') {
        await auth.signUp({ email: emailValue, password: passwordValue });
        message.textContent = 'Hesap oluşturuldu. E-posta onayı gerekiyorsa gelen kutusunu kontrol et.';
        message.className = 'auth-message';
      } else if (formMode === 'reset') {
        await auth.resetPassword({ email: emailValue });
        message.textContent = 'Şifre sıfırlama bağlantısı gönderildi.';
        message.className = 'auth-message';
      } else {
        await auth.signIn({ email: emailValue, password: passwordValue });
        await renderRoute();
      }
    } catch (error) {
      message.textContent = error?.message || 'İşlem başarısız oldu.';
      message.className = 'auth-message error';
    }
  });

  switchToRegister?.addEventListener('click', () => renderAuthScreen('register'));
  switchToReset?.addEventListener('click', () => renderAuthScreen('reset'));
  switchToLogin?.addEventListener('click', () => renderAuthScreen('login'));
}

async function renderRoute() {
  if (!appRoot) return;

  const hash = window.location.hash || '#/chat';
  currentRoute = normalizeRoute(hash);

  if (currentRoute === 'chat') {
    const initialized = await auth.init();
    currentAuthState = initialized;

    if (!initialized?.user || !initialized?.session) {
      currentAuthState = {
        user: { id: getFallbackUserId() },
        session: { user: { id: getFallbackUserId() } },
        configured: false,
      };
    }

    await renderChatShell();
    return;
  }

  if (currentRoute === 'register') {
    renderAuthScreen('register');
    return;
  }

  if (currentRoute === 'reset') {
    renderAuthScreen('reset');
    return;
  }

  const initialized = await auth.init();
  currentAuthState = initialized;
  if (initialized?.user && initialized?.session) {
    window.location.hash = '#/chat';
    return;
  }

  renderAuthScreen('login');
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('hashchange', () => {
    void renderRoute();
  });

  window.addEventListener('load', () => {
    void renderRoute();
    window.setTimeout(() => {
      void refreshMemoryPanel();
    }, 0);
  });

  window.addEventListener('DOMContentLoaded', () => {
    void renderRoute();
  });
}
