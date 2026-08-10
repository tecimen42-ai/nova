function getWindow() {
  return typeof window !== 'undefined' ? window : undefined;
}

export function getStorageKey(baseKey, userId = null) {
  if (typeof userId === 'string' && userId.trim()) {
    return `${baseKey}:${userId.trim()}`;
  }

  return baseKey;
}

export function normalizeRoute(hash = '') {
  const route = String(hash || '').replace(/^#/, '').replace(/^\//, '').split('?')[0];

  if (!route || route === 'login') {
    return 'login';
  }

  if (route === 'register') {
    return 'register';
  }

  if (route === 'reset') {
    return 'reset';
  }

  if (route === 'chat') {
    return 'chat';
  }

  return 'login';
}

export async function loadSupabaseConfig() {
  const win = getWindow();
  const fromWindow = win?.__NOVA_SUPABASE_CONFIG__;
  if (fromWindow?.url && fromWindow?.anonKey) {
    return { url: fromWindow.url, anonKey: fromWindow.anonKey };
  }

  try {
    const response = await fetch('/api/config');
    if (!response.ok) {
      return { url: '', anonKey: '' };
    }

    const payload = await response.json();
    const config = {
      url: payload.supabaseUrl || '',
      anonKey: payload.supabaseAnonKey || '',
    };

    if (win) {
      win.__NOVA_SUPABASE_CONFIG__ = config;
    }

    return config;
  } catch (error) {
    return { url: '', anonKey: '' };
  }
}

export function createSupabaseClient() {
  const win = getWindow();
  if (!win?.supabase?.createClient) {
    return null;
  }

  const config = win.__NOVA_SUPABASE_CONFIG__ || {};
  if (!config.url || !config.anonKey) {
    return null;
  }

  return win.supabase.createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}

export function createAuthModule() {
  let currentUser = null;
  let currentSession = null;
  let configured = false;
  let client = null;
  let listeners = [];

  const emit = (nextState) => {
    currentUser = nextState.user || null;
    currentSession = nextState.session || null;
    configured = nextState.configured ?? configured;
    listeners.forEach((listener) => listener(nextState));
  };

  const subscribe = (listener) => {
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((item) => item !== listener);
    };
  };

  const init = async () => {
    const config = await loadSupabaseConfig();
    const win = getWindow();
    if (win) {
      win.__NOVA_SUPABASE_CONFIG__ = config;
    }

    if (!config.url || !config.anonKey) {
      emit({ user: null, session: null, configured: false });
      return { user: null, session: null, configured: false };
    }

    client = createSupabaseClient();
    if (!client) {
      emit({ user: null, session: null, configured: false });
      return { user: null, session: null, configured: false };
    }

    const { data: { session } } = await client.auth.getSession();
    emit({ user: session?.user || null, session, configured: true });

    client.auth.onAuthStateChange((_event, session) => {
      emit({ user: session?.user || null, session, configured: true });
    });

    return { user: currentUser, session: currentSession, configured: true };
  };

  const signIn = async ({ email, password }) => {
    if (!client) {
      throw new Error('Supabase is not configured.');
    }

    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      throw error;
    }

    emit({ user: data?.user || null, session: data?.session || null, configured: true });
    return data;
  };

  const signUp = async ({ email, password }) => {
    if (!client) {
      throw new Error('Supabase is not configured.');
    }

    const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/#/login` : undefined;
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
    });

    if (error) {
      throw error;
    }

    emit({ user: data?.user || null, session: data?.session || null, configured: true });
    return data;
  };

  const resetPassword = async ({ email }) => {
    if (!client) {
      throw new Error('Supabase is not configured.');
    }

    const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/#/login` : undefined;
    const { data, error } = await client.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
    if (error) {
      throw error;
    }

    return data;
  };

  const signOut = async () => {
    if (!client) {
      emit({ user: null, session: null, configured: false });
      return;
    }

    await client.auth.signOut();
    emit({ user: null, session: null, configured: true });
  };

  const getUser = () => currentUser;
  const getSession = () => currentSession;
  const getClient = () => client;
  const isAuthenticated = () => Boolean(currentUser && currentSession);
  const getState = () => ({ user: currentUser, session: currentSession, configured });

  return {
    init,
    subscribe,
    signIn,
    signUp,
    resetPassword,
    signOut,
    getUser,
    getSession,
    getClient,
    isAuthenticated,
    getState,
  };
}

export const auth = createAuthModule();
