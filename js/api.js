(function () {
  const CONFIG = window.ENAU_CONFIG || {};

  function isValidHttpUrl(value) {
    try {
      const u = new URL(value);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch (_) {
      return false;
    }
  }

  function supabaseConfigured() {
    const url = CONFIG.SUPABASE_URL || '';
    const key = CONFIG.SUPABASE_ANON_KEY || '';
    return (
      isValidHttpUrl(url) &&
      !!url &&
      !!key &&
      !url.includes('COLE_SEU_SUPABASE_URL') &&
      !key.includes('COLE_SUA_SUPABASE_ANON_KEY')
    );
  }

  let client = null;
  function getClient() {
    if (client) return client;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      throw new Error('SDK do Supabase não carregado.');
    }
    if (!supabaseConfigured()) {
      throw new Error('Configure SUPABASE_URL e SUPABASE_ANON_KEY em js/config.js');
    }
    client = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
    return client;
  }

  async function callRpc(functionName, params) {
    const sb = getClient();
    const { data, error } = await sb.rpc(functionName, params || {});
    if (error) throw error;
    return data;
  }

  window.ENAU_API = Object.assign(window.ENAU_API || {}, {
    isValidHttpUrl,
    supabaseConfigured,
    getClient,
    callRpc
  });
})();
