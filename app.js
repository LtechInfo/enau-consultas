// ═══════════════════════════════
// DATA
// ═══════════════════════════════
let ALUNOS = [];

const TURMA_LABELS = {
  'EN_MATERNAL1_T_':'Maternal I','EN_MATERNAL2_T_':'Maternal II',
  'EN_EI1_T_A':'Ed. Infantil 1','EN_EI2_T_A':'Ed. Infantil 2',
  'EN_EF1_T_A':'EF 1º Ano (V)','EN_EF2_T_A':'EF 2º Ano (V)',
  'EN_EF3_T_A':'EF 3º Ano (V)','EN_EF4_T_A':'EF 4º Ano (V)',
  'EN_EF5_T_A':'EF 5º Ano (V)','EN_EF6_M_A':'EF 6º Ano (M)',
  'EN_EF7_M_A':'EF 7º Ano (M)','EN_EF8_M_A':'EF 8º Ano (M)',
  'EN_EF9_M_A':'EF 9º Ano (M)','EN_EM1_M_A':'EM 1º Ano (M)',
  'EN_EM2_M_A':'EM 2º Ano (M)','EN_EM3_M_A':'EM 3º Ano (M)',
  'EN_COMPLEMENTA':'Período Complementar','EN_COMP_AVULSO':'Compl. Avulso'
};
let USERS;
const TURMAS_BY_CURSO = {
  'Educação Infantil':['EN_MATERNAL1_T_','EN_MATERNAL2_T_','EN_EI1_T_A','EN_EI2_T_A'],
  'Ensino Fundamental':['EN_EF1_T_A','EN_EF2_T_A','EN_EF3_T_A','EN_EF4_T_A','EN_EF5_T_A','EN_EF6_M_A','EN_EF7_M_A','EN_EF8_M_A','EN_EF9_M_A'],
  'Ensino Médio':['EN_EM1_M_A','EN_EM2_M_A','EN_EM3_M_A'],
  'Período Complementar':['EN_COMPLEMENTA','EN_COMP_AVULSO']
};

const CONFIG = window.ENAU_CONFIG || {};
const APP_STATE = window.ENAU_STATE || (window.ENAU_STATE = {});
const UTILS = window.ENAU_UTILS || {};
const SUPABASE_URL = String(CONFIG.SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = String(CONFIG.SUPABASE_ANON_KEY || '').trim();
const APP_SESSION_KEY = CONFIG.APP_SESSION_KEY || 'enau_user';
const PASSWORD_MIN_LENGTH = Number(CONFIG.PASSWORD_MIN_LENGTH || 8);
USERS = {};
let supabaseClient = null;
let usersLoaded = false;
let supabaseInitError = '';

// ═══════════════════════════════
// AUTH
// ═══════════════════════════════
let currentUser = null;
let userPageMode = 'create';
let pendingPasswordChange = null;
let totalStudentsCount = 0;
let lastSearchRequestId = 0;
let searchDebounceTimer = null;
let adminRows = [];
let adminTotalCount = 0;
let batchFileName = '';

function normalizeUsername(value) {
  return (value || '').trim().toLowerCase();
}
function setLoginError(message) {
  const err = document.getElementById('login-error');
  if (!err) return;
  err.textContent = message;
  err.style.display = 'block';
}
function clearLoginError() {
  const err = document.getElementById('login-error');
  if (!err) return;
  err.style.display = 'none';
}
function setForcePassError(message) {
  const err = document.getElementById('force-pass-error');
  if (!err) return;
  err.textContent = message;
  err.style.display = 'block';
}
function clearForcePassError() {
  const err = document.getElementById('force-pass-error');
  if (!err) return;
  err.style.display = 'none';
}
function enterForcePasswordMode() {
  const main = document.getElementById('login-main-fields');
  const box = document.getElementById('force-pass-box');
  if (main) main.classList.add('force-hidden');
  if (box) box.style.display = 'block';
  const p1 = document.getElementById('force-new-pass');
  const p2 = document.getElementById('force-new-pass-2');
  if (p1) p1.value = '';
  if (p2) p2.value = '';
  clearForcePassError();
  clearLoginError();
  if (p1) p1.focus();
}
function exitForcePasswordMode() {
  const main = document.getElementById('login-main-fields');
  const box = document.getElementById('force-pass-box');
  if (main) main.classList.remove('force-hidden');
  if (box) box.style.display = 'none';
  const p1 = document.getElementById('force-new-pass');
  const p2 = document.getElementById('force-new-pass-2');
  if (p1) p1.value = '';
  if (p2) p2.value = '';
  clearForcePassError();
}
function isValidHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch (_) {
    return false;
  }
}
function supabaseConfigured() {
  return (
    isValidHttpUrl(SUPABASE_URL) &&
    SUPABASE_URL &&
    SUPABASE_ANON_KEY &&
    !SUPABASE_URL.includes('COLE_SEU_SUPABASE_URL') &&
    !SUPABASE_ANON_KEY.includes('COLE_SUA_SUPABASE_ANON_KEY')
  );
}
function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  if (!window.supabase || typeof window.supabase.createClient !== 'function') return null;
  if (!supabaseConfigured()) {
    supabaseInitError = 'SUPABASE_URL inválida. Use o formato: https://SEU-PROJECT-REF.supabase.co';
    return null;
  }
  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
  } catch (err) {
    supabaseInitError = err?.message || 'Falha ao iniciar cliente Supabase.';
    return null;
  }
  return supabaseClient;
}
async function callRpc(functionName, params = {}) {
  const client = getSupabaseClient();
  if (!client) throw new Error(supabaseInitError || 'Configure SUPABASE_URL e SUPABASE_ANON_KEY em js/config.js.');
  const { data, error } = await client.rpc(functionName, params);
  if (error) throw error;
  return data;
}
function parseRpcNumber(value, fallback = 0) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (!value.length) return fallback;
    const first = value[0];
    if (typeof first === 'number' && Number.isFinite(first)) return first;
    if (typeof first === 'object' && first) {
      const nested = Object.values(first)[0];
      const parsedNested = Number(nested);
      if (Number.isFinite(parsedNested)) return parsedNested;
    }
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function mapDbUsers(rows) {
  const mapped = {};
  (rows || []).forEach(row => {
    const username = normalizeUsername(row.username);
    if (!username) return;
    mapped[username] = {
      id: row.id,
      name: row.full_name || row.name || username,
      role: row.role === 'admin' ? 'admin' : 'user'
    };
  });
  return mapped;
}
async function refreshUsersState() {
  if (!currentUser?.sessionToken) {
    USERS = {};
    usersLoaded = false;
    return USERS;
  }
  if (currentUser.role !== 'admin') {
    USERS = {
      [currentUser.username]: {
        id: currentUser.id,
        name: currentUser.name,
        role: currentUser.role
      }
    };
    usersLoaded = true;
    return USERS;
  }
  const rows = await callRpc('app_list_users_secure', { p_session_token: currentUser.sessionToken });
  USERS = mapDbUsers(rows);
  usersLoaded = true;
  return USERS;
}
function mapStudentRow(row) {
  const turma = row.turma || '';
  return {
    ra: valueToString(row.ra),
    nome: valueToString(row.nome).toUpperCase(),
    nascimento: valueToString(row.nascimento),
    email_aluno: valueToString(row.email_aluno),
    curso: valueToString(row.curso),
    turma,
    turma_label: TURMA_LABELS[turma] || turma,
    turno: valueToString(row.turno) || 'V',
    fase: valueToString(row.fase),
    tipo: valueToString(row.tipo || 'VETERANO').toUpperCase(),
    nome_pai: valueToString(row.nome_pai).toUpperCase(),
    nome_mae: valueToString(row.nome_mae).toUpperCase(),
    nome_financeiro: valueToString(row.nome_financeiro).toUpperCase(),
    nome_pedagogico: valueToString(row.nome_pedagogico).toUpperCase(),
    email_pedagogico: valueToString(row.email_pedagogico),
    celular: valueToString(row.celular),
    fone_resid: valueToString(row.fone_resid),
    fone_com: valueToString(row.fone_com)
  };
}
async function refreshStudentsState({ search = '', turma = '', curso = '', pageSize = 50, offset = 0 } = {}) {
  if (!currentUser?.sessionToken) {
    ALUNOS = [];
    filtered = [];
    totalStudentsCount = 0;
    return { rows: ALUNOS, total: totalStudentsCount };
  }
  const [rows, totalResult] = await Promise.all([
    callRpc('app_students_list', {
      p_session_token: currentUser.sessionToken,
      p_search: search || null,
      p_limit: pageSize,
      p_offset: offset,
      p_turma: turma || null,
      p_curso: curso || null
    }),
    callRpc('app_students_count', {
      p_session_token: currentUser.sessionToken,
      p_search: search || null,
      p_turma: turma || null,
      p_curso: curso || null
    })
  ]);
  ALUNOS = (rows || []).map(mapStudentRow);
  totalStudentsCount = parseRpcNumber(totalResult, 0);
  filtered = [...ALUNOS];
  return { rows: ALUNOS, total: totalStudentsCount };
}
async function loadRecentImports() {
  const tbody = document.querySelector('#batch-runs-table tbody');
  const empty = document.getElementById('batch-runs-empty');
  const wrap = document.getElementById('batch-runs-list');
  if (!tbody || !empty || !wrap) return;
  if (!currentUser?.sessionToken) {
    empty.style.display = 'block';
    wrap.style.display = 'none';
    return;
  }
  try {
    const runs = await callRpc('app_import_runs_list', {
      p_session_token: currentUser.sessionToken,
      p_limit: 20
    });
    APP_STATE.recentImportRuns = runs || [];
    if (!runs || !runs.length) {
      empty.style.display = 'block';
      wrap.style.display = 'none';
      tbody.innerHTML = '';
      return;
    }
    empty.style.display = 'none';
    wrap.style.display = 'block';
    tbody.innerHTML = runs.map(run => `
      <tr>
        <td>${new Date(run.created_at).toLocaleString('pt-BR')}</td>
        <td>${run.file_name || 'manual'}</td>
        <td>${run.total_rows || 0}</td>
        <td>${run.new_count || 0}</td>
        <td>${run.updated_count || 0}</td>
        <td>${run.unchanged_count || 0}</td>
        <td>${run.invalid_count || 0}</td>
        <td><button class="btn-secondary" onclick="downloadImportReport('${run.id}')">⬇ Relatório</button></td>
      </tr>
    `).join('');
  } catch (err) {
    empty.style.display = 'block';
    wrap.style.display = 'none';
    showAlert('alert-batch', 'error', explainRpcError(err));
  }
}
function explainRpcError(err) {
  const raw = err?.message || err?.details || String(err || 'Erro desconhecido.');
  if (/function .* does not exist|schema cache/i.test(raw)) {
    return 'Funções SQL do Supabase não encontradas. Rode o arquivo scripts/supabase_roadmap_full.sql no SQL Editor.';
  }
  if (/Sessão inválida ou expirada/i.test(raw)) {
    doLogout();
    return 'Sua sessão expirou. Faça login novamente.';
  }
  return raw;
}
function csvEscape(value) {
  const s = valueToString(value);
  if (s.includes('"') || s.includes(',') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
async function downloadImportReport(runId) {
  if (!currentUser?.sessionToken || !runId) return;
  try {
    const rows = await callRpc('app_import_run_report', {
      p_session_token: currentUser.sessionToken,
      p_run_id: runId
    });
    const list = rows || [];
    if (!list.length) {
      showAlert('alert-batch', 'error', 'Esse relatório não possui linhas para exportar.');
      return;
    }
    const header = [
      'row_number',
      'status',
      'ra',
      'nome',
      'curso',
      'turma',
      'turno',
      'tipo',
      'reason',
      'changed_fields'
    ];
    const lines = [header.join(',')];
    list.forEach(row => {
      const n = row.normalized_row || {};
      lines.push(
        [
          row.row_number,
          row.status,
          row.ra,
          n.nome,
          n.curso,
          n.turma,
          n.turno,
          n.tipo,
          row.reason || '',
          Array.isArray(row.changed_fields) ? row.changed_fields.join('|') : ''
        ].map(csvEscape).join(',')
      );
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `import_report_${runId}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    showAlert('alert-batch', 'error', explainRpcError(err));
  }
}
function persistCurrentUser() {
  if (currentUser) {
    sessionStorage.setItem(APP_SESSION_KEY, JSON.stringify(currentUser));
  } else {
    sessionStorage.removeItem(APP_SESSION_KEY);
  }
}
function applyTheme(theme) {
  const dark = theme === 'dark';
  document.body.classList.toggle('dark-theme', dark);
  localStorage.setItem('enau_theme', dark ? 'dark' : 'light');
  const icon = dark
    ? '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v2.2M12 19.8V22M22 12h-2.2M4.2 12H2M19.1 4.9l-1.5 1.5M6.4 17.6l-1.5 1.5M19.1 19.1l-1.5-1.5M6.4 6.4L4.9 4.9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  document.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.innerHTML = icon;
    btn.title = dark ? 'Modo claro' : 'Modo escuro';
  });
}
function toggleTheme() {
  applyTheme(document.body.classList.contains('dark-theme') ? 'light' : 'dark');
}
function syncCurrentUserUI() {
  if (!currentUser) {
    doLogout();
    return;
  }
  const uinfo = USERS[currentUser.username] || currentUser;
  if (!uinfo) {
    doLogout();
    return;
  }
  currentUser = {
    ...currentUser,
    id: uinfo.id || currentUser.id || null,
    username: currentUser.username,
    name: uinfo.name || currentUser.name,
    role: uinfo.role || currentUser.role || 'user'
  };
  persistCurrentUser();
  document.getElementById('user-name-badge').textContent = uinfo.name;
  document.getElementById('user-name-badge2').textContent = uinfo.name;
  document.getElementById('btn-nav-admin').style.display = uinfo.role === 'admin' ? 'block' : 'none';
  document.getElementById('btn-nav-admin2').style.display = uinfo.role === 'admin' ? 'block' : 'none';
  if (uinfo.role !== 'admin') navTo('consulta');
}
function setNavButtonState(btnId, active) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.classList.toggle('active', active);
  btn.classList.toggle('inactive', !active);
}
function updateNavState(dest) {
  const consulta = dest !== 'admin';
  setNavButtonState('btn-nav-consulta', consulta);
  setNavButtonState('btn-nav-admin', !consulta);
  setNavButtonState('btn-nav-consulta2', consulta);
  setNavButtonState('btn-nav-admin2', !consulta);
}
function setupUIAccessibility() {
  document.querySelectorAll('button:not([type])').forEach(btn => btn.type = 'button');
  document.querySelectorAll('.alert').forEach(el => {
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
  });
  const tabsWrap = document.querySelector('.admin-tabs');
  if (tabsWrap) tabsWrap.setAttribute('role', 'tablist');
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', btn.classList.contains('active') ? 'true' : 'false');
  });
  document.querySelectorAll('.admin-panel').forEach(panel => panel.setAttribute('role', 'tabpanel'));
  document.querySelectorAll('#results-table thead th[onclick]').forEach(th => {
    th.tabIndex = 0;
    th.setAttribute('role', 'button');
    if (!th.dataset.kbdBound) {
      th.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          th.click();
        }
      });
      th.dataset.kbdBound = '1';
    }
  });
}

async function applySessionFromServer(sessionToken) {
  const result = await callRpc('app_session_me', { p_session_token: sessionToken });
  const row = Array.isArray(result) ? result[0] : result;
  if (!row || !row.user_id || !row.username) {
    throw new Error('Sessão inválida.');
  }
  currentUser = {
    id: row.user_id,
    username: normalizeUsername(row.username),
    name: row.full_name || row.username,
    role: row.role === 'admin' ? 'admin' : 'user',
    sessionToken
  };
  persistCurrentUser();
  return row;
}

document.addEventListener('DOMContentLoaded', async () => {
  applyTheme(localStorage.getItem('enau_theme') || 'light');
  document.getElementById('input-pass').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
  document.getElementById('input-user').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
  document.getElementById('force-new-pass').addEventListener('keydown', e => { if(e.key==='Enter') submitForcedPasswordChange(); });
  document.getElementById('force-new-pass-2').addEventListener('keydown', e => { if(e.key==='Enter') submitForcedPasswordChange(); });
  document.getElementById('f-curso').addEventListener('change', updateTurmaOptions);
  setupUIAccessibility();
  exitForcePasswordMode();
  const saved = sessionStorage.getItem(APP_SESSION_KEY);
  if (!saved) return;
  try {
    const parsed = JSON.parse(saved);
    if (!parsed || !parsed.sessionToken) throw new Error('Sessão inválida');
    const me = await applySessionFromServer(parsed.sessionToken);
    if (me.must_change_password) {
      throw new Error('Troca de senha pendente');
    }
    await refreshUsersState();
    await showApp();
  } catch (err) {
    doLogout();
    const message = String(err?.message || '');
    if (message.includes('Troca de senha')) {
      setLoginError('Para acessar o sistema, faça login e altere a senha no primeiro acesso.');
    } else {
      setLoginError('Sessão encerrada. Faça login novamente.');
    }
  }
});

async function doLogin() {
  const u = normalizeUsername(document.getElementById('input-user').value);
  const p = document.getElementById('input-pass').value;
  const userInput = document.getElementById('input-user');
  const passInput = document.getElementById('input-pass');
  if (!u || !p) {
    setLoginError('Informe usuário e senha para continuar.');
    userInput.setAttribute('aria-invalid', String(!u));
    passInput.setAttribute('aria-invalid', String(!p));
    (!u ? userInput : passInput).focus();
    return;
  }
  if (!getSupabaseClient()) {
    setLoginError(supabaseInitError || 'Configure SUPABASE_URL e SUPABASE_ANON_KEY em js/config.js antes de fazer login.');
    return;
  }
  try {
    const result = await callRpc('app_login', {
      p_username: u,
      p_password: p
    });
    const row = Array.isArray(result) ? result[0] : result;
    if (!row || !row.ok) {
      setLoginError(row?.error_message || 'Usuário ou senha incorretos.');
      userInput.setAttribute('aria-invalid', 'true');
      passInput.setAttribute('aria-invalid', 'true');
      passInput.value = '';
      passInput.focus();
      return;
    }
    currentUser = {
      id: row.user_id || null,
      username: normalizeUsername(row.username || u),
      name: row.full_name || u,
      role: row.role === 'admin' ? 'admin' : 'user',
      sessionToken: row.session_token || null
    };
    if (!currentUser.sessionToken) {
      throw new Error('Sessão não iniciada no servidor.');
    }
    const mustChangePassword = row.must_change_password === true;
    if (mustChangePassword) {
      pendingPasswordChange = {
        sessionToken: currentUser.sessionToken,
        username: currentUser.username,
        oldPassword: p
      };
      persistCurrentUser();
      userInput.removeAttribute('aria-invalid');
      passInput.removeAttribute('aria-invalid');
      passInput.value = '';
      enterForcePasswordMode();
      return;
    }
    pendingPasswordChange = null;
    persistCurrentUser();
    try {
      await refreshUsersState();
    } catch (_) {
      USERS = {
        [currentUser.username]: {
          id: currentUser.id,
          name: currentUser.name,
          role: currentUser.role
        }
      };
      usersLoaded = true;
    }
    clearLoginError();
    await showApp();
    userInput.removeAttribute('aria-invalid');
    passInput.removeAttribute('aria-invalid');
  } catch (err) {
    setLoginError(explainRpcError(err));
    userInput.setAttribute('aria-invalid', 'true');
    passInput.setAttribute('aria-invalid', 'true');
    passInput.value = '';
    passInput.focus();
  }
}

async function submitForcedPasswordChange() {
  if (!pendingPasswordChange || !pendingPasswordChange.sessionToken) {
    doLogout();
    setLoginError('Sua sessão expirou. Faça login novamente.');
    return;
  }
  const newPass = document.getElementById('force-new-pass').value;
  const confirmPass = document.getElementById('force-new-pass-2').value;
  if (!newPass || !confirmPass) {
    setForcePassError('Preencha e confirme a nova senha.');
    return;
  }
  if (newPass.length < PASSWORD_MIN_LENGTH) {
    setForcePassError(`A nova senha deve ter no mínimo ${PASSWORD_MIN_LENGTH} caracteres.`);
    return;
  }
  if (newPass !== confirmPass) {
    setForcePassError('As senhas não conferem.');
    return;
  }
  if (newPass === pendingPasswordChange.oldPassword) {
    setForcePassError('A nova senha deve ser diferente da senha atual.');
    return;
  }
  try {
    await callRpc('app_change_password_first_login', {
      p_session_token: pendingPasswordChange.sessionToken,
      p_old_password: pendingPasswordChange.oldPassword,
      p_new_password: newPass
    });
    pendingPasswordChange = null;
    exitForcePasswordMode();
    persistCurrentUser();
    try {
      await refreshUsersState();
    } catch (_) {
      USERS = {
        [currentUser.username]: {
          id: currentUser.id,
          name: currentUser.name,
          role: currentUser.role
        }
      };
      usersLoaded = true;
    }
    await showApp();
  } catch (err) {
    setForcePassError(explainRpcError(err));
  }
}

function cancelForcedPasswordChange() {
  if (pendingPasswordChange?.sessionToken) {
    callRpc('app_logout', { p_session_token: pendingPasswordChange.sessionToken }).catch(() => {});
  }
  doLogout();
  setLoginError('Para acessar o sistema, é obrigatório trocar a senha no primeiro login.');
}

function doLogout() {
  const token = currentUser?.sessionToken || pendingPasswordChange?.sessionToken;
  if (token) {
    callRpc('app_logout', { p_session_token: token }).catch(() => {});
  }
  pendingPasswordChange = null;
  currentUser = null;
  USERS = {};
  persistCurrentUser();
  usersLoaded = false;
  document.getElementById('login-screen').style.display='flex';
  document.getElementById('app-screen').style.display='none';
  document.getElementById('admin-screen').style.display='none';
  document.getElementById('input-user').value=''; document.getElementById('input-pass').value='';
  exitForcePasswordMode();
  clearLoginError();
}

async function showApp() {
  document.getElementById('login-screen').style.display='none';
  document.getElementById('app-screen').style.display='flex';
  document.getElementById('admin-screen').style.display='none';
  syncCurrentUserUI();
  updateNavState('consulta');
  await initApp();
}

function navTo(dest) {
  if (dest === 'admin') {
    if (!currentUser || currentUser.role !== 'admin') return;
    document.getElementById('app-screen').style.display='none';
    document.getElementById('admin-screen').style.display='flex';
    updateNavState('admin');
    void initAdminList();
    void renderUserList();
  } else {
    document.getElementById('admin-screen').style.display='none';
    document.getElementById('app-screen').style.display='flex';
    updateNavState('consulta');
    doSearch({ immediate: true, keepPage: true });
  }
}

// ═══════════════════════════════
// CONSULTA
// ═══════════════════════════════
let filtered = [...ALUNOS], sortField = 'nome', sortAsc = true, page = 1;
const PER_PAGE = 25;

async function initApp() {
  const turmas = Object.keys(TURMA_LABELS).sort();
  const sel = document.getElementById('filter-turma');
  sel.innerHTML = '<option value="">Todas as turmas</option>';
  turmas.forEach(t => {
    const op = document.createElement('option');
    op.value = t; op.textContent = fmtTurma(t); sel.appendChild(op);
  });
  document.getElementById('stat-turmas').textContent = turmas.length;
  page = 1;
  await doSearchNow({ keepPage: true });
}

function fmtTurma(t) { return TURMA_LABELS[t] || t; }
function norm(s) { return (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }

function doSearch(options = {}) {
  const { immediate = false, keepPage = false } = options;
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
  if (immediate) {
    void doSearchNow({ keepPage });
    return;
  }
  searchDebounceTimer = setTimeout(() => {
    void doSearchNow({ keepPage });
  }, 220);
}
async function doSearchNow({ keepPage = false } = {}) {
  const qRaw = document.getElementById('search-input').value.trim();
  const turma = document.getElementById('filter-turma').value;
  const curso = document.getElementById('filter-curso').value;
  if (!keepPage) page = 1;
  const reqId = ++lastSearchRequestId;
  try {
    const { rows, total } = await refreshStudentsState({
      search: qRaw,
      turma,
      curso,
      pageSize: PER_PAGE,
      offset: (page - 1) * PER_PAGE
    });
    if (reqId !== lastSearchRequestId) return;
    filtered = [...rows];
    if (!qRaw && !turma && !curso) {
      APP_STATE.globalStudentTotal = total;
    }
    applySort();
    render({ total, q: qRaw, turma, curso });
  } catch (err) {
    if (reqId !== lastSearchRequestId) return;
    filtered = [];
    totalStudentsCount = 0;
    render({ total: 0, q: qRaw, turma, curso });
    console.error(err);
  }
}

function sortBy(f) {
  if (sortField===f) sortAsc=!sortAsc; else { sortField=f; sortAsc=true; }
  applySort(); render();
}
function applySort() {
  filtered.sort((a,b) => {
    const va=(a[sortField]||'').toLowerCase(), vb=(b[sortField]||'').toLowerCase();
    return sortAsc ? va.localeCompare(vb,'pt') : vb.localeCompare(va,'pt');
  });
}
function clearSearch() {
  document.getElementById('search-input').value='';
  document.getElementById('filter-turma').value='';
  document.getElementById('filter-curso').value='';
  doSearch({ immediate: true });
}

function cursoBadge(c) {
  if(c.includes('Infantil')) return '<span class="badge badge-ei">Ed. Infantil</span>';
  if(c.includes('Fundamental')) return '<span class="badge badge-ef">Fund.</span>';
  if(c.includes('Médio')) return '<span class="badge badge-em">Médio</span>';
  return '<span class="badge badge-pc">Compl.</span>';
}
function turnoTag(t) {
  if(t==='M') return '<span class="turno-tag turno-m">Manhã</span>';
  if(t==='V') return '<span class="turno-tag turno-v">Vespertino</span>';
  return '<span class="turno-tag turno-mv">Integral</span>';
}
function hl(text, q) {
  if(!q||!text) return text||'—';
  const nT=norm(text), nQ=norm(q), idx=nT.indexOf(nQ);
  if(idx===-1) return text;
  return text.slice(0,idx)+'<mark class="hl-match">'+text.slice(idx,idx+q.length)+'</mark>'+text.slice(idx+q.length);
}

function render({ total = totalStudentsCount, q, turma, curso } = {}) {
  const qText = q !== undefined ? q : document.getElementById('search-input').value.trim();
  const turmaVal = turma !== undefined ? turma : document.getElementById('filter-turma').value;
  const cursoVal = curso !== undefined ? curso : document.getElementById('filter-curso').value;
  const totalSafe = Number.isFinite(total) ? total : 0;
  const pages = Math.max(1, Math.ceil(totalSafe / PER_PAGE));
  if(page>pages) {
    page=pages;
    doSearch({ immediate: true, keepPage: true });
    return;
  }
  const slice=filtered;
  const totalGlobal = APP_STATE.globalStudentTotal ?? totalSafe;
  document.getElementById('stat-total').textContent = totalGlobal;
  document.getElementById('stat-results').textContent = totalSafe;
  const countEl = document.getElementById('results-count');
  const sortMap = { nome:'th-nome', turma:'th-turma', nome_mae:'th-mae', nome_pai:'th-pai' };
  document.querySelectorAll('#results-table thead th').forEach(th => {
    th.classList.remove('sorted');
    th.removeAttribute('aria-sort');
  });
  const activeSortHeader = document.getElementById(sortMap[sortField] || '');
  if (activeSortHeader) {
    activeSortHeader.classList.add('sorted');
    activeSortHeader.setAttribute('aria-sort', sortAsc ? 'ascending' : 'descending');
  }
  if(totalSafe===0) countEl.innerHTML='';
  else if(!qText && !turmaVal && !cursoVal) countEl.innerHTML=`Exibindo <strong>todos os ${totalSafe} alunos</strong>`;
  else countEl.innerHTML=`<strong>${totalSafe}</strong> resultado${totalSafe>1?'s':''} encontrado${totalSafe>1?'s':''}`;
  const tbody=document.getElementById('results-body'), empty=document.getElementById('empty-state');
  const thead=document.querySelector('#results-table thead');
  if(totalSafe===0){ tbody.innerHTML=''; thead.style.display='none'; empty.style.display='block'; }
  else {
    thead.style.display=''; empty.style.display='none';
    tbody.innerHTML=slice.map((a, idx) => {
      const phone = a.celular || a.fone_resid || '';
      return `<tr tabindex="0" role="button" aria-label="Abrir ficha do aluno" onclick="openModal(${idx})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openModal(${idx});}">
        <td class="td-nome">${hl(a.nome,qText)}</td>
        <td><span class="td-turma">${fmtTurma(a.turma)}</span></td>
        <td>${cursoBadge(a.curso)}</td>
        <td>${turnoTag(a.turno)}</td>
        <td style="color:var(--g700);font-size:0.82rem">${hl(a.nome_mae||'—',qText)}</td>
        <td style="color:var(--g700);font-size:0.82rem">${hl(a.nome_pai||'—',qText)}</td>
        <td class="phone-cell">${phone||'—'}</td>
        <td><span class="tipo-badge ${a.tipo==='VETERANO'?'tipo-v':'tipo-c'}">${a.tipo==='VETERANO'?'Vet.':'Cal.'}</span></td>
      </tr>`;
    }).join('');
  }
  const pag=document.getElementById('pagination');
  if(pages<=1){ pag.innerHTML=''; return; }
  let h=`<button class="page-btn" onclick="goPage(${page-1})" ${page===1?'disabled':''}>‹</button>`;
  for(let i=1;i<=pages;i++){
    if(i===1||i===pages||Math.abs(i-page)<=2) h+=`<button class="page-btn ${i===page?'active':''}" onclick="goPage(${i})">${i}</button>`;
    else if(Math.abs(i-page)===3) h+=`<span style="color:var(--g500);padding:0 4px">…</span>`;
  }
  h+=`<button class="page-btn" onclick="goPage(${page+1})" ${page===pages?'disabled':''}>›</button>`;
  pag.innerHTML=h;
}

function goPage(p) {
  if (p < 1) return;
  page = p;
  doSearch({ immediate: true, keepPage: true });
  document.getElementById('table-wrap').scrollIntoView({behavior:'smooth',block:'start'});
}

// ═══════════════════════════════
// MODAL
// ═══════════════════════════════
function openModal(idx) {
  const a=ALUNOS[idx];
  if (!a) return;
  document.getElementById('m-nome').textContent=a.nome;
  document.getElementById('m-meta').innerHTML=`${cursoBadge(a.curso)}<span class="td-turma">${fmtTurma(a.turma)}</span>${turnoTag(a.turno)}<span class="tipo-badge ${a.tipo==='VETERANO'?'tipo-v':'tipo-c'}">${a.tipo}</span>`;
  
  // Phones
  const phones = [];
  if(a.celular) phones.push({icon:'📱',label:'Celular',val:a.celular});
  if(a.fone_resid) phones.push({icon:'🏠',label:'Residencial',val:a.fone_resid});
  if(a.fone_com) phones.push({icon:'💼',label:'Comercial',val:a.fone_com});
  const phonesHtml = phones.length ? `<div class="phone-row">${phones.map(p=>`<span class="phone-chip"><svg width="13" height="13" viewBox="0 0 13 13"><path d="M2 2h3l1 3-2 1.5a8 8 0 003.5 3.5L9 8l3 1v3a1 1 0 01-1 1C5 13 0 8 0 3a1 1 0 011-1z" fill="#9a7fa8"/></svg>${p.label}: ${p.val}</span>`).join('')}</div>` : '';

  const parentCard = (role, name, email, ph=[]) => {
    if(!name) return '';
    const phHtml = ph.length ? `<div class="phone-row">${ph.map(p=>`<span class="phone-chip">${p}</span>`).join('')}</div>` : '';
    return `<div class="parent-card"><div class="role">${role}</div><div class="pname">${name}</div>${email?`<div class="pcontact">✉ ${email}</div>`:''}${phHtml}</div>`;
  };

  // Resp. cards — group phones under resp. pedagógico
  const pedPhone = phones.length ? phones.map(p=>`${p.label}: ${p.val}`) : [];
  
  let parentsHtml = '';
  if(a.nome_pai && a.nome_pai !== a.nome_mae) parentsHtml += parentCard('Pai', a.nome_pai, '', []);
  if(a.nome_mae) parentsHtml += parentCard('Mãe', a.nome_mae, '', []);
  if(a.nome_financeiro && a.nome_financeiro !== a.nome_pai && a.nome_financeiro !== a.nome_mae)
    parentsHtml += parentCard('Resp. Financeiro', a.nome_financeiro, '', []);
  if(a.nome_pedagogico && a.nome_pedagogico !== a.nome_pai && a.nome_pedagogico !== a.nome_mae)
    parentsHtml += parentCard('Resp. Pedagógico', a.nome_pedagogico, a.email_pedagogico, pedPhone);
  else if(a.email_pedagogico)
    parentsHtml += `<div class="parent-card"><div class="role">E-mail pedagógico</div><div class="pcontact">✉ ${a.email_pedagogico}</div></div>`;

  document.getElementById('m-body').innerHTML=`
    <div class="info-section">
      <div class="info-section-title">📋 Dados do Aluno</div>
      <div class="info-grid">
        <div class="info-item"><label>RA</label><div class="info-value">${a.ra}</div></div>
        <div class="info-item"><label>Nascimento</label><div class="info-value">${a.nascimento||'—'}</div></div>
        <div class="info-item"><label>Fase / Série</label><div class="info-value">${a.fase}º — ${a.curso}</div></div>
        <div class="info-item"><label>Turno</label><div class="info-value">${a.turno==='M'?'Manhã':a.turno==='V'?'Vespertino':'Integral'}</div></div>
        ${a.email_aluno && a.email_aluno!=='null'?`<div class="info-item full"><label>E-mail Institucional</label><div class="info-value">${a.email_aluno}</div></div>`:''}
        ${phonesHtml?`<div class="info-item full"><label>Telefones de Contato</label>${phonesHtml}</div>`:''}
      </div>
    </div>
    <div class="info-section">
      <div class="info-section-title">👨‍👩‍👧 Filiação e Responsáveis</div>
      ${parentsHtml||'<p style="color:var(--g500);font-size:0.85rem">Sem dados cadastrados</p>'}
    </div>`;
  document.getElementById('modal-overlay').classList.add('active');
  document.body.style.overflow='hidden';
}
function closeModal(e) { if(e.target===document.getElementById('modal-overlay')) closeModalBtn(); }
function closeModalBtn() { document.getElementById('modal-overlay').classList.remove('active'); document.body.style.overflow=''; }
document.addEventListener('keydown', e => {
  const modalOpen = document.getElementById('modal-overlay').classList.contains('active');
  if(e.key==='Escape' && modalOpen) closeModalBtn();
});

// ═══════════════════════════════
// ADMIN — LIST
// ═══════════════════════════════
let adminPage = 1;
const ADMIN_PER = 20;

async function initAdminList() {
  adminPage = 1;
  await renderAdminList();
  void renderUserList();
}
function initUsersAdmin() { void renderUserList(); clearUserForm(); }

async function renderAdminList() {
  const q = document.getElementById('admin-search').value.trim();
  const tbody = document.getElementById('admin-table-body');
  if (!currentUser?.sessionToken) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:var(--g500)">Faça login novamente para carregar a lista.</td></tr>';
    return;
  }
  try {
    const [rows, totalResult] = await Promise.all([
      callRpc('app_students_list', {
        p_session_token: currentUser.sessionToken,
        p_search: q || null,
        p_limit: ADMIN_PER,
        p_offset: (adminPage - 1) * ADMIN_PER
      }),
      callRpc('app_students_count', {
        p_session_token: currentUser.sessionToken,
        p_search: q || null
      })
    ]);
    adminRows = (rows || []).map(mapStudentRow);
    adminTotalCount = parseRpcNumber(totalResult, 0);
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:var(--g500)">Não foi possível carregar alunos.</td></tr>';
    showAlert('alert-list', 'error', explainRpcError(err));
    return;
  }

  const pages = Math.max(1, Math.ceil(adminTotalCount / ADMIN_PER));
  if (adminPage > pages) {
    adminPage = pages;
    await renderAdminList();
    return;
  }

  const adminRowsHtml = adminRows.map(a => `
    <tr>
      <td><strong>${a.ra}</strong></td>
      <td>${a.nome}</td>
      <td><span class="td-turma">${fmtTurma(a.turma)}</span></td>
      <td>${a.celular||a.fone_resid||'—'}</td>
      <td>
        <button class="edit-row-btn" onclick="editAlunoByRa('${encodeURIComponent(a.ra)}')">✏️ Editar</button>
        <button class="del-row-btn" onclick="deleteAlunoByRa('${encodeURIComponent(a.ra)}')">🗑</button>
      </td>
    </tr>
  `);
  renderRowsIncremental(tbody, adminRowsHtml, 80);

  let ph='';
  if(pages>1){
    ph+=`<button class="page-btn" onclick="adminGoPage(${adminPage-1})" ${adminPage===1?'disabled':''}>‹</button>`;
    for(let i=1;i<=pages;i++){
      if(i===1||i===pages||Math.abs(i-adminPage)<=1) ph+=`<button class="page-btn ${i===adminPage?'active':''}" onclick="adminGoPage(${i})">${i}</button>`;
      else if(Math.abs(i-adminPage)===2) ph+=`<span style="color:var(--g500);padding:0 2px">…</span>`;
    }
    ph+=`<button class="page-btn" onclick="adminGoPage(${adminPage+1})" ${adminPage===pages?'disabled':''}>›</button>`;
  }
  document.getElementById('admin-pagination').innerHTML=ph;
}
function adminGoPage(p){
  if (p < 1) return;
  adminPage=p;
  void renderAdminList();
}

async function renderUserList() {
  const body = document.getElementById('users-table-body');
  if (!body) return;
  if (!usersLoaded) {
    try {
      await refreshUsersState();
    } catch (err) {
      showAlert('alert-users-list', 'error', explainRpcError(err));
      body.innerHTML = '';
      return;
    }
  }
  const q = norm((document.getElementById('user-search')?.value || '').trim());
  const entries = Object.entries(USERS)
    .filter(([username, user]) => !q || norm(username).includes(q) || norm(user.name).includes(q))
    .sort((a, b) => a[0].localeCompare(b[0], 'pt'));
  if (!entries.length) {
    body.innerHTML = '<tr><td colspan="4" style="color:var(--g500)">Nenhum usuário encontrado.</td></tr>';
    return;
  }
  body.innerHTML = entries.map(([username, user]) => `
    <tr>
      <td><strong>${username}</strong></td>
      <td>${user.name}</td>
      <td>${user.role === 'admin' ? 'Administrador' : 'Usuário'}</td>
      <td>
        <button class="edit-row-btn" onclick="editUser('${encodeURIComponent(username)}')">Editar</button>
        <button class="del-row-btn" onclick="deleteUser('${encodeURIComponent(username)}')">Excluir</button>
      </td>
    </tr>
  `).join('');
}

function editUser(encodedUsername) {
  const username = decodeURIComponent(encodedUsername);
  const user = USERS[username];
  if (!user) return;
  switchTab('tab-users');
  userPageMode = 'edit';
  document.getElementById('u-username').value = username;
  document.getElementById('u-username').disabled = true;
  document.getElementById('u-name').value = user.name;
  document.getElementById('u-pass').value = '';
  document.getElementById('u-pass').placeholder = 'Deixe em branco para manter a senha atual';
  document.getElementById('u-role').value = user.role;
  document.getElementById('btn-save-user').setAttribute('data-edit-username', username);
  document.getElementById('btn-save-user').textContent = 'Atualizar Usuário';
  document.getElementById('btn-cancel-user-edit').style.display = 'block';
  document.getElementById('user-form-title').textContent = 'Editar Usuário';
  document.getElementById('user-form-sub').textContent = `Editando o acesso de ${user.name}`;
}

function clearUserForm() {
  userPageMode = 'create';
  ['u-username', 'u-name', 'u-pass'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('u-pass').placeholder = 'Defina uma senha';
  document.getElementById('u-role').value = 'user';
  document.getElementById('u-username').disabled = false;
  document.getElementById('btn-save-user').removeAttribute('data-edit-username');
  document.getElementById('btn-save-user').textContent = 'Salvar Usuário';
  document.getElementById('btn-cancel-user-edit').style.display = 'none';
  document.getElementById('user-form-title').textContent = 'Cadastrar Usuário';
  document.getElementById('user-form-sub').textContent = 'Defina login, nome, senha e perfil de acesso';
}

async function saveUser() {
  if (!currentUser?.sessionToken || currentUser.role !== 'admin') {
    showAlert('alert-users-form', 'error', 'Apenas administrador pode gerenciar usuários.');
    return;
  }
  const username = normalizeUsername(document.getElementById('u-username').value);
  const name = document.getElementById('u-name').value.trim();
  const pass = document.getElementById('u-pass').value.trim();
  const role = document.getElementById('u-role').value;
  const editing = document.getElementById('btn-save-user').getAttribute('data-edit-username');
  if (!username || !name || !role) {
    showAlert('alert-users-form', 'error', 'Usuário, nome e perfil são obrigatórios.');
    return;
  }
  try {
    if (!usersLoaded) await refreshUsersState();
    if (!editing) {
      if (!pass) {
        showAlert('alert-users-form', 'error', 'Senha é obrigatória para novo usuário.');
        return;
      }
      if (pass.length < PASSWORD_MIN_LENGTH) {
        showAlert('alert-users-form', 'error', `Senha deve ter no mínimo ${PASSWORD_MIN_LENGTH} caracteres.`);
        return;
      }
      if (USERS[username]) {
        showAlert('alert-users-form', 'error', `O usuário ${username} já existe.`);
        return;
      }
      await callRpc('app_create_user_secure', {
        p_session_token: currentUser.sessionToken,
        p_username: username,
        p_password: pass,
        p_full_name: name,
        p_role: role
      });
    } else {
      const user = USERS[editing];
      if (!user) {
        showAlert('alert-users-form', 'error', 'Usuário não encontrado para edição.');
        return;
      }
      if (pass && pass.length < PASSWORD_MIN_LENGTH) {
        showAlert('alert-users-form', 'error', `Senha deve ter no mínimo ${PASSWORD_MIN_LENGTH} caracteres.`);
        return;
      }
      await callRpc('app_update_user_secure', {
        p_session_token: currentUser.sessionToken,
        p_user_id: user.id,
        p_full_name: name,
        p_role: role,
        p_new_password: pass || null,
        p_is_active: true,
        p_force_password_change: pass ? true : null
      });
    }
    await refreshUsersState();
    clearUserForm();
    await renderUserList();
    const targetKey = editing || username;
    if (currentUser && targetKey === currentUser.username) {
      const me = USERS[targetKey];
      if (me) {
        currentUser = { ...currentUser, id: me.id, name: me.name, role: me.role };
        persistCurrentUser();
      }
      syncCurrentUserUI();
    }
    showAlert('alert-users-form', 'success', editing ? 'Usuário atualizado com sucesso.' : 'Usuário cadastrado com sucesso.');
  } catch (err) {
    showAlert('alert-users-form', 'error', explainRpcError(err));
  }
}

async function deleteUser(encodedUsername) {
  if (!currentUser?.sessionToken || currentUser.role !== 'admin') {
    showAlert('alert-users-list', 'error', 'Apenas administrador pode excluir usuários.');
    return;
  }
  const username = decodeURIComponent(encodedUsername);
  if (!USERS[username]) return;
  if (currentUser && username === currentUser.username) {
    showAlert('alert-users-list', 'error', 'Você não pode excluir o usuário atualmente logado.');
    return;
  }
  if (!confirm(`Excluir o usuário ${username}?`)) return;
  try {
    await callRpc('app_delete_user_secure', {
      p_session_token: currentUser.sessionToken,
      p_user_id: USERS[username].id
    });
    await refreshUsersState();
    await renderUserList();
    clearUserForm();
    showAlert('alert-users-list', 'success', 'Usuário excluído com sucesso.');
  } catch (err) {
    showAlert('alert-users-list', 'error', explainRpcError(err));
  }
}

function fillAlunoForm(a) {
  if (!a) return;
  switchTab('tab-add');
  document.getElementById('form-title').textContent='Editar Aluno';
  document.getElementById('form-sub').textContent=`Editando: ${a.nome} (RA ${a.ra})`;
  document.getElementById('f-ra').value=a.ra; document.getElementById('f-ra').disabled=true;
  document.getElementById('f-nome').value=a.nome;
  document.getElementById('f-nasc').value=a.nascimento||'';
  document.getElementById('f-email').value=a.email_aluno||'';
  document.getElementById('f-curso').value=a.curso;
  updateTurmaOptions();
  document.getElementById('f-turma').value=a.turma;
  document.getElementById('f-turno').value=a.turno||'V';
  document.getElementById('f-fase').value=a.fase||'';
  document.getElementById('f-tipo').value=a.tipo||'VETERANO';
  document.getElementById('f-pai').value=a.nome_pai||'';
  document.getElementById('f-mae').value=a.nome_mae||'';
  document.getElementById('f-fin').value=a.nome_financeiro||'';
  document.getElementById('f-ped').value=a.nome_pedagogico||'';
  document.getElementById('f-email-ped').value=a.email_pedagogico||'';
  document.getElementById('f-celular').value=a.celular||'';
  document.getElementById('f-fone-r').value=a.fone_resid||'';
  document.getElementById('f-fone-c').value=a.fone_com||'';
  document.getElementById('btn-save').textContent='Atualizar Aluno';
  document.getElementById('btn-save').setAttribute('data-edit-ra', a.ra);
  document.getElementById('btn-cancel-edit').style.display='block';
}
async function editAlunoByRa(encodedRa) {
  const ra = decodeURIComponent(encodedRa);
  let a = adminRows.find(row => normalizeRa(row.ra) === normalizeRa(ra));
  if (!a && currentUser?.sessionToken) {
    const rows = await callRpc('app_students_list', {
      p_session_token: currentUser.sessionToken,
      p_search: ra,
      p_limit: 1,
      p_offset: 0
    });
    a = (rows || []).map(mapStudentRow)[0];
  }
  if (!a) {
    showAlert('alert-list', 'error', 'Aluno não encontrado para edição.');
    return;
  }
  fillAlunoForm(a);
}
function editAluno(idx) {
  const a = ALUNOS[idx];
  fillAlunoForm(a);
}
async function deleteAlunoByRa(encodedRa) {
  if (!currentUser?.sessionToken || currentUser.role !== 'admin') {
    showAlert('alert-list', 'error', 'Apenas administrador pode excluir alunos.');
    return;
  }
  const ra = decodeURIComponent(encodedRa);
  const row = adminRows.find(a => normalizeRa(a.ra) === normalizeRa(ra));
  const label = row?.nome ? `${row.nome} (RA ${ra})` : `RA ${ra}`;
  if(!confirm(`Excluir ${label}? Esta ação não pode ser desfeita.`)) return;
  try {
    await callRpc('app_student_delete', {
      p_session_token: currentUser.sessionToken,
      p_ra: ra
    });
    APP_STATE.globalStudentTotal = null;
    showAlert('alert-list', 'success', 'Aluno excluído com sucesso.');
    await renderAdminList();
    await doSearchNow({ keepPage: true });
  } catch (err) {
    showAlert('alert-list', 'error', explainRpcError(err));
  }
}
function deleteAluno(idx) {
  const a = ALUNOS[idx];
  if (!a?.ra) return;
  void deleteAlunoByRa(encodeURIComponent(a.ra));
}

// ═══════════════════════════════
// ADMIN — FORM
// ═══════════════════════════════
function updateTurmaOptions() {
  const curso = document.getElementById('f-curso').value;
  const sel = document.getElementById('f-turma');
  sel.innerHTML = '<option value="">Selecione...</option>';
  (TURMAS_BY_CURSO[curso]||[]).forEach(t => {
    const op = document.createElement('option');
    op.value=t; op.textContent=fmtTurma(t); sel.appendChild(op);
  });
}

async function saveAluno() {
  if (!currentUser?.sessionToken || currentUser.role !== 'admin') {
    showAlert('alert-form','error','Apenas administrador pode salvar alunos.');
    return;
  }
  const ra = document.getElementById('f-ra').value.trim();
  const nome = document.getElementById('f-nome').value.trim().toUpperCase();
  const curso = document.getElementById('f-curso').value;
  const turma = document.getElementById('f-turma').value;
  if(!ra||!nome||!curso||!turma) { showAlert('alert-form','error','RA, Nome, Curso e Turma são obrigatórios.'); return; }

  const btn = document.getElementById('btn-save');
  const editRa = btn.getAttribute('data-edit-ra');
  const finalRa = (editRa || ra || '').trim();
  const newAluno = {
    ra: finalRa, nome,
    nascimento: document.getElementById('f-nasc').value.trim(),
    email_aluno: document.getElementById('f-email').value.trim(),
    curso, turma, turma_label: TURMA_LABELS[turma]||turma,
    turno: document.getElementById('f-turno').value,
    fase: document.getElementById('f-fase').value.trim(),
    tipo: document.getElementById('f-tipo').value,
    nome_pai: document.getElementById('f-pai').value.trim().toUpperCase(),
    nome_mae: document.getElementById('f-mae').value.trim().toUpperCase(),
    nome_financeiro: document.getElementById('f-fin').value.trim().toUpperCase(),
    nome_pedagogico: document.getElementById('f-ped').value.trim().toUpperCase(),
    email_pedagogico: document.getElementById('f-email-ped').value.trim(),
    celular: document.getElementById('f-celular').value.trim(),
    fone_resid: document.getElementById('f-fone-r').value.trim(),
    fone_com: document.getElementById('f-fone-c').value.trim(),
  };

  try {
    const result = await callRpc('app_student_upsert', {
      p_session_token: currentUser.sessionToken,
      p_payload: newAluno
    });
    const row = Array.isArray(result) ? result[0] : result;
    const action = row?.action || (editRa ? 'updated' : 'new');
    APP_STATE.globalStudentTotal = null;
    if (action === 'updated') {
      showAlert('alert-form','success',`Aluno ${nome} atualizado com sucesso!`);
    } else if (action === 'unchanged') {
      showAlert('alert-form','success',`Nenhuma alteração necessária para ${nome}.`);
    } else {
      showAlert('alert-form','success',`Aluno ${nome} cadastrado com sucesso!`);
    }
    clearForm();
    await Promise.all([
      doSearchNow({ keepPage: true }),
      renderAdminList()
    ]);
  } catch (err) {
    showAlert('alert-form','error', explainRpcError(err));
  }
}

function clearForm() {
  ['f-ra','f-nome','f-nasc','f-email','f-fase','f-pai','f-mae','f-fin','f-ped','f-email-ped','f-celular','f-fone-r','f-fone-c'].forEach(id=>{ document.getElementById(id).value=''; });
  document.getElementById('f-ra').disabled=false;
  document.getElementById('f-curso').value=''; document.getElementById('f-turno').value='V'; document.getElementById('f-tipo').value='VETERANO';
  document.getElementById('f-turma').innerHTML='<option value="">Selecione o curso primeiro</option>';
  document.getElementById('btn-save').textContent='Salvar Aluno';
  document.getElementById('btn-save').removeAttribute('data-edit-ra');
  document.getElementById('form-title').textContent='Cadastrar Novo Aluno';
  document.getElementById('form-sub').textContent='Preencha os dados do aluno';
  document.getElementById('btn-cancel-edit').style.display='none';
}
function cancelEdit() { clearForm(); }

// ═══════════════════════════════
// ADMIN — BATCH
// ═══════════════════════════════
let batchData = [];
const BATCH_COLUMN_ALIASES = {
  ra: ['ra', 'ra_filho'],
  nome: ['nome', 'nome_filho'],
  nascimento: ['nascimento', 'data_nascimento'],
  email_aluno: ['email_aluno', 'email_filho', 'email_instituicao_filho', 'email_instiuicao_filho'],
  curso: ['curso'],
  turma: ['turma'],
  turno: ['turno'],
  fase: ['fase'],
  tipo: ['tipo', 'calouro_veterano'],
  nome_pai: ['nome_pai'],
  nome_mae: ['nome_mae'],
  nome_financeiro: ['nome_financeiro', 'nome_fin'],
  nome_pedagogico: ['nome_pedagogico', 'nome_ped'],
  email_pedagogico: ['email_pedagogico', 'email_ped'],
  celular: ['celular', 'cel', 'cel_mae', 'cel_pai'],
  fone_resid: ['fone_resid', 'telefone_residencial'],
  fone_com: ['fone_com', 'telefone_comercial']
};

function normalizeBatchKey(key) {
  return (key || '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
function valueToString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}
function normalizeRa(value) {
  return valueToString(value).replace(/\.0+$/, '');
}
function normalizeTurno(value) {
  const v = valueToString(value).toUpperCase();
  if (v === 'INTEGRAL') return 'MeV';
  if (v === 'MATUTINO') return 'M';
  if (v === 'VESPERTINO') return 'V';
  return v || 'V';
}
function normalizeTipo(value) {
  const v = valueToString(value).toUpperCase();
  if (v.includes('CALOU')) return 'CALOURO';
  if (v.includes('VETER')) return 'VETERANO';
  return v || 'VETERANO';
}
function findByAliases(normalizedRow, aliases) {
  for (const alias of aliases) {
    const val = normalizedRow[alias];
    if (valueToString(val)) return valueToString(val);
  }
  return '';
}
function normalizeImportedRow(rawRow) {
  const normalized = {};
  Object.entries(rawRow || {}).forEach(([key, value]) => {
    normalized[normalizeBatchKey(key)] = valueToString(value);
  });
  const ra = normalizeRa(findByAliases(normalized, BATCH_COLUMN_ALIASES.ra));
  const nome = findByAliases(normalized, BATCH_COLUMN_ALIASES.nome).toUpperCase();
  const turma = findByAliases(normalized, BATCH_COLUMN_ALIASES.turma);
  return {
    ra,
    nome,
    nascimento: findByAliases(normalized, BATCH_COLUMN_ALIASES.nascimento),
    email_aluno: findByAliases(normalized, BATCH_COLUMN_ALIASES.email_aluno),
    curso: findByAliases(normalized, BATCH_COLUMN_ALIASES.curso),
    turma,
    turma_label: TURMA_LABELS[turma] || turma || '',
    turno: normalizeTurno(findByAliases(normalized, BATCH_COLUMN_ALIASES.turno)),
    fase: findByAliases(normalized, BATCH_COLUMN_ALIASES.fase),
    tipo: normalizeTipo(findByAliases(normalized, BATCH_COLUMN_ALIASES.tipo)),
    nome_pai: findByAliases(normalized, BATCH_COLUMN_ALIASES.nome_pai).toUpperCase(),
    nome_mae: findByAliases(normalized, BATCH_COLUMN_ALIASES.nome_mae).toUpperCase(),
    nome_financeiro: findByAliases(normalized, BATCH_COLUMN_ALIASES.nome_financeiro).toUpperCase(),
    nome_pedagogico: findByAliases(normalized, BATCH_COLUMN_ALIASES.nome_pedagogico).toUpperCase(),
    email_pedagogico: findByAliases(normalized, BATCH_COLUMN_ALIASES.email_pedagogico),
    celular: findByAliases(normalized, BATCH_COLUMN_ALIASES.celular),
    fone_resid: findByAliases(normalized, BATCH_COLUMN_ALIASES.fone_resid),
    fone_com: findByAliases(normalized, BATCH_COLUMN_ALIASES.fone_com)
  };
}
function parseCsvTextToObjects(raw) {
  if (window.XLSX) {
    const wb = XLSX.read(raw, { type: 'string' });
    const sheetName = wb.SheetNames[0];
    return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: false });
  }
  const lines = raw.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const delimiter = (lines[0].split(';').length > lines[0].split(',').length) ? ';' : ',';
  const headers = lines[0].split(delimiter).map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = line.split(delimiter);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] || '').trim(); });
    return obj;
  });
}
function renderRowsIncremental(tbody, rowsHtml, chunkSize = 150) {
  if (!tbody) return;
  tbody.innerHTML = '';
  let index = 0;
  function step() {
    if (index >= rowsHtml.length) return;
    const end = Math.min(index + chunkSize, rowsHtml.length);
    tbody.insertAdjacentHTML('beforeend', rowsHtml.slice(index, end).join(''));
    index = end;
    if (index < rowsHtml.length) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
function renderBatchPreviewRows(previewRows) {
  const counts = { new: 0, updated: 0, unchanged: 0, invalid: 0 };
  (previewRows || []).forEach(r => {
    const k = r.status || 'invalid';
    counts[k] = (counts[k] || 0) + 1;
  });
  const summaryEl = document.getElementById('batch-preview-summary');
  summaryEl.innerHTML = `
    <span class="batch-summary-chip">📄 Lidas: <strong>${previewRows.length}</strong></span>
    <span class="batch-summary-chip">🟢 Novas: <strong>${counts.new || 0}</strong></span>
    <span class="batch-summary-chip">🟡 Atualizadas: <strong>${counts.updated || 0}</strong></span>
    <span class="batch-summary-chip">⚪ Sem alteração: <strong>${counts.unchanged || 0}</strong></span>
    <span class="batch-summary-chip">🔴 Inválidas: <strong>${counts.invalid || 0}</strong></span>
  `;

  const previewCols = ['row_number', 'status', 'ra', 'nome', 'reason', 'changed_fields'];
  const th = previewCols.map(c => `<th>${c}</th>`).join('');
  const rowHtml = (previewRows || []).map(r => {
    const fields = Array.isArray(r.changed_fields) ? r.changed_fields.join(', ') : '';
    return `<tr>
      <td>${r.row_number ?? ''}</td>
      <td>${r.status || ''}</td>
      <td>${r.ra || '—'}</td>
      <td>${r.nome || '—'}</td>
      <td>${r.reason || '—'}</td>
      <td>${fields || '—'}</td>
    </tr>`;
  });
  document.querySelector('#preview-table thead').innerHTML = `<tr>${th}</tr>`;
  renderRowsIncremental(document.querySelector('#preview-table tbody'), rowHtml, 120);
  document.getElementById('batch-preview-title').textContent = `${previewRows.length} linha(s) processadas no preview`;
  document.getElementById('batch-preview').style.display = 'block';
}
async function parseImportedRows(rawRows, fileName = '') {
  const mapped = (rawRows || []).map(normalizeImportedRow);
  const lastIndexByRa = new Map();
  mapped.forEach((row, index) => {
    if (row.ra) lastIndexByRa.set(row.ra, index);
  });
  batchData = mapped.filter((row, index) => !row.ra || lastIndexByRa.get(row.ra) === index);
  if (!batchData.length) {
    showAlert('alert-batch', 'error', 'Nenhuma linha encontrada para processar.');
    return;
  }
  if (!currentUser?.sessionToken || currentUser.role !== 'admin') {
    showAlert('alert-batch', 'error', 'Apenas administrador pode realizar importações.');
    return;
  }
  try {
    APP_STATE.lastImportFileName = fileName || 'importacao_manual';
    batchFileName = APP_STATE.lastImportFileName;
    const preview = await callRpc('app_import_preview', {
      p_session_token: currentUser.sessionToken,
      p_rows: batchData
    });
    APP_STATE.batchPreviewRows = preview || [];
    renderBatchPreviewRows(APP_STATE.batchPreviewRows);
  } catch (err) {
    showAlert('alert-batch', 'error', explainRpcError(err));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const dz = document.getElementById('drop-zone');
  if(dz){
    dz.addEventListener('dragover', e=>{ e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', ()=>dz.classList.remove('dragover'));
    dz.addEventListener('drop', e=>{ e.preventDefault(); dz.classList.remove('dragover'); handleFile(e.dataTransfer.files[0]); });
  }
  const fi = document.getElementById('file-input');
  if(fi) fi.addEventListener('change', e=>handleFile(e.target.files[0]));
});

function handleFile(file) {
  if(!file) return;
  batchFileName = file.name || '';
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'xls' || ext === 'xlsx') {
    if (!window.XLSX) {
      showAlert('alert-batch', 'error', 'Leitor XLS não carregado. Atualize a página e tente novamente.');
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', raw: false });
        const sheetName = wb.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: false });
        void parseImportedRows(rows, file.name);
        showAlert('alert-batch', 'success', `Arquivo ${file.name} lido com sucesso.`);
      } catch (err) {
        showAlert('alert-batch', 'error', `Erro ao ler XLS: ${err.message || err}`);
      }
    };
    reader.readAsArrayBuffer(file);
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('csv-paste').value = e.target.result || '';
    void parseBatchCSV(file.name);
  };
  reader.readAsText(file, 'UTF-8');
}

async function parseBatchCSV(fileName = '') {
  const raw = document.getElementById('csv-paste').value.trim();
  if(!raw){ showAlert('alert-batch','error','Nenhum dado para processar.'); return; }
  if (fileName) batchFileName = fileName;
  try {
    const rows = parseCsvTextToObjects(raw);
    if (!rows.length) {
      showAlert('alert-batch', 'error', 'O conteúdo deve ter pelo menos cabeçalho + 1 linha.');
      return;
    }
    await parseImportedRows(rows, fileName || batchFileName || 'importacao_colada.csv');
  } catch (err) {
    showAlert('alert-batch', 'error', `Erro ao processar CSV: ${err.message || err}`);
  }
}

async function confirmBatchImport() {
  if (!currentUser?.sessionToken || currentUser.role !== 'admin') {
    showAlert('alert-batch','error','Apenas administrador pode confirmar importações.');
    return;
  }
  if (!batchData.length) {
    showAlert('alert-batch','error','Nenhum preview pronto para importar.');
    return;
  }
  try {
    const result = await callRpc('app_import_confirm', {
      p_session_token: currentUser.sessionToken,
      p_file_name: APP_STATE.lastImportFileName || batchFileName || null,
      p_rows: batchData
    });
    const row = Array.isArray(result) ? result[0] : result;
    const added = Number(row?.new_count || 0);
    const updated = Number(row?.updated_count || 0);
    const unchanged = Number(row?.unchanged_count || 0);
    const invalid = Number(row?.invalid_count || 0);
    APP_STATE.globalStudentTotal = null;
    document.getElementById('batch-preview').style.display='none';
    document.getElementById('csv-paste').value='';
    document.getElementById('batch-preview-summary').innerHTML = '';
    batchData=[];
    batchFileName = '';
    APP_STATE.batchPreviewRows = [];
    APP_STATE.lastImportFileName = '';
    showAlert('alert-batch','success',`Importação concluída! ${added} novo(s), ${updated} atualizado(s), ${unchanged} sem alteração e ${invalid} inválido(s).`);
    await Promise.all([
      doSearchNow({ keepPage: true }),
      renderAdminList(),
      loadRecentImports()
    ]);
  } catch (err) {
    showAlert('alert-batch','error', explainRpcError(err));
  }
}

function downloadTemplate() {
  const header='ra,nome,nascimento,curso,turma,turno,fase,tipo,nome_pai,nome_mae,nome_financeiro,nome_pedagogico,email_pedagogico,celular,fone_resid,fone_com';
  const sample='99999,NOME DO ALUNO,01/01/2015,Ensino Fundamental,EN_EF6_M_A,M,6,VETERANO,NOME DO PAI,NOME DA MAE,NOME FINANCEIRO,NOME PEDAGÓGICO,email@exemplo.com,(11)99999-9999,(11)4825-0000,';
  const blob=new Blob([header+'\n'+sample],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='modelo_importacao_enau.csv'; a.click();
}

function showAlert(id, type, msg) {
  const el=document.getElementById(id);
  if (!el) return;
  el.className=`alert ${type}`; el.textContent=msg; el.style.display='flex';
  el.setAttribute('aria-atomic', 'true');
  setTimeout(()=>el.style.display='none', 4000);
}

function switchTab(tabId) {
  document.querySelectorAll('.admin-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b=>{
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
  });
  document.getElementById(tabId).classList.add('active');
  const idx=['tab-list','tab-add','tab-batch','tab-users'].indexOf(tabId);
  const targetBtn = document.querySelectorAll('.tab-btn')[idx];
  targetBtn.classList.add('active');
  targetBtn.setAttribute('aria-selected', 'true');
  if(tabId==='tab-list') void renderAdminList();
  if(tabId==='tab-batch') void loadRecentImports();
  if(tabId==='tab-users') initUsersAdmin();
}


