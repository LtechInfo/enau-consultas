(function () {
  "use strict";

  const cfg = window.APP_CONFIG || {};
  if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) {
    return;
  }

  const APP_SESSION_KEY = cfg.APP_SESSION_KEY || "enau_app_session_v1";
  const AUTH_FUNCTION_NAME = cfg.AUTH_FUNCTION_NAME || "auth-username-login";
  const { createClient } = window.supabase;
  const noStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };

  function createAppClient(headers = {}) {
    return createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
      global: { headers },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storage: noStorage,
      },
    });
  }

  let accessToken = null;
  let supabase = createAppClient();
  let sessionUser = null;
  let usersLoaded = false;

  function rebindClient() {
    const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
    supabase = createAppClient(headers);
  }

  function persistSession() {
    if (!accessToken || !sessionUser) return;
    localStorage.setItem(
      APP_SESSION_KEY,
      JSON.stringify({ token: accessToken, user: sessionUser, ts: Date.now() })
    );
  }

  function clearPersistedSession() {
    localStorage.removeItem(APP_SESSION_KEY);
    sessionStorage.removeItem("enau_user");
  }

  function ensureUserInMap(user) {
    if (!user) return;
    if (!window.USERS) window.USERS = {};
    window.USERS[user.username] = {
      name: user.name,
      role: user.role,
      pass: "***",
    };
  }

  function setLoginError(msg) {
    const err = document.getElementById("login-error");
    if (!err) return;
    err.textContent = msg;
    err.style.display = "block";
  }

  function hideLoginError() {
    const err = document.getElementById("login-error");
    if (!err) return;
    err.style.display = "none";
  }

  async function fetchAlunos() {
    const { data, error } = await supabase
      .from("alunos")
      .select("*")
      .order("nome", { ascending: true });
    if (error) throw error;
    window.ALUNOS = (data || []).map((a) => ({
      ...a,
      turma_label: window.TURMA_LABELS?.[a.turma] || a.turma,
    }));
    return window.ALUNOS;
  }

  async function fetchUsers() {
    const { data, error } = await supabase.rpc("app_list_users_safe");
    if (error) throw error;
    const mapped = {};
    (data || []).forEach((u) => {
      mapped[u.username] = { name: u.name, role: u.role, pass: "***" };
    });
    window.USERS = mapped;
    usersLoaded = true;
    return mapped;
  }

  async function loginByUsername(username, password) {
    const { data, error } = await supabase.functions.invoke(AUTH_FUNCTION_NAME, {
      body: { username, password },
    });
    if (error) throw error;
    if (!data?.access_token || !data?.user) {
      throw new Error("Resposta de autenticação inválida.");
    }
    return data;
  }

  async function syncUserAndApp() {
    if (!sessionUser) return;
    ensureUserInMap(sessionUser);
    window.currentUser = sessionUser.username;
    if (typeof window.syncCurrentUserUI === "function") {
      window.syncCurrentUserUI();
    }
    try {
      await fetchAlunos();
    } catch (err) {
      setLoginError("Falha ao carregar alunos do Supabase.");
      throw err;
    }
    if (typeof window.initApp === "function") {
      window.initApp();
    }
  }

  function restoreSession() {
    try {
      const raw = localStorage.getItem(APP_SESSION_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!parsed?.token || !parsed?.user) return false;
      accessToken = parsed.token;
      sessionUser = parsed.user;
      window.currentUser = sessionUser.username;
      ensureUserInMap(sessionUser);
      rebindClient();
      return true;
    } catch (_) {
      return false;
    }
  }

  async function refreshDataAfterMutation() {
    await fetchAlunos();
    if (typeof window.doSearch === "function") window.doSearch();
    const totalEl = document.getElementById("stat-total");
    if (totalEl) totalEl.textContent = String(window.ALUNOS.length);
  }

  const oldShowApp = window.showApp;
  window.showApp = async function showAppSupabase() {
    const login = document.getElementById("login-screen");
    const app = document.getElementById("app-screen");
    const admin = document.getElementById("admin-screen");
    if (login) login.style.display = "none";
    if (app) app.style.display = "flex";
    if (admin) admin.style.display = "none";
    hideLoginError();
    await syncUserAndApp();
    if (typeof window.updateNavState === "function") window.updateNavState("consulta");
    if (typeof oldShowApp === "function") {
      // Keep any non-data side effects from original flow.
      // Original initApp is already called via syncUserAndApp, so avoid double-loading data.
    }
  };

  window.doLogout = function doLogoutSupabase() {
    accessToken = null;
    sessionUser = null;
    window.currentUser = null;
    usersLoaded = false;
    window.USERS = {};
    rebindClient();
    clearPersistedSession();
    const login = document.getElementById("login-screen");
    const app = document.getElementById("app-screen");
    const admin = document.getElementById("admin-screen");
    if (login) login.style.display = "flex";
    if (app) app.style.display = "none";
    if (admin) admin.style.display = "none";
    const iu = document.getElementById("input-user");
    const ip = document.getElementById("input-pass");
    if (iu) iu.value = "";
    if (ip) ip.value = "";
    hideLoginError();
  };

  window.doLogin = async function doLoginSupabase() {
    const userInput = document.getElementById("input-user");
    const passInput = document.getElementById("input-pass");
    const username = (userInput?.value || "").trim().toLowerCase();
    const password = passInput?.value || "";
    if (!username || !password) {
      setLoginError("Informe usuário e senha para continuar.");
      if (!username && userInput) userInput.focus();
      else if (passInput) passInput.focus();
      return;
    }
    try {
      const payload = await loginByUsername(username, password);
      accessToken = payload.access_token;
      sessionUser = payload.user;
      rebindClient();
      persistSession();
      if (passInput) passInput.value = "";
      await window.showApp();
    } catch (_) {
      setLoginError("Usuário ou senha inválidos.");
      if (passInput) {
        passInput.value = "";
        passInput.focus();
      }
    }
  };

  window.renderAdminList = async function renderAdminListSupabase() {
    if (!window.currentUser) return;
    try {
      if (!Array.isArray(window.ALUNOS) || !window.ALUNOS.length) {
        await fetchAlunos();
      }
      const q = window.norm(document.getElementById("admin-search").value.trim());
      const filtered = window.ALUNOS.filter((a) => !q || window.norm(a.nome).includes(q) || a.ra.includes(q));
      const pages = Math.max(1, Math.ceil(filtered.length / window.ADMIN_PER));
      if (window.adminPage > pages) window.adminPage = 1;
      const slice = filtered.slice((window.adminPage - 1) * window.ADMIN_PER, window.adminPage * window.ADMIN_PER);
      document.getElementById("admin-table-body").innerHTML = slice
        .map((a) => {
          const idx = window.ALUNOS.indexOf(a);
          return `<tr>
      <td><strong>${a.ra}</strong></td>
      <td>${a.nome}</td>
      <td><span class="td-turma">${window.fmtTurma(a.turma)}</span></td>
      <td>${a.celular || a.fone_resid || "—"}</td>
      <td>
        <button class="edit-row-btn" onclick="editAluno(${idx})">✏️ Editar</button>
        <button class="del-row-btn" onclick="deleteAluno(${idx})">🗑</button>
      </td>
    </tr>`;
        })
        .join("");
      let ph = "";
      if (pages > 1) {
        ph += `<button class="page-btn" onclick="adminGoPage(${window.adminPage - 1})" ${window.adminPage === 1 ? "disabled" : ""}>‹</button>`;
        for (let i = 1; i <= pages; i += 1) {
          if (i === 1 || i === pages || Math.abs(i - window.adminPage) <= 1) {
            ph += `<button class="page-btn ${i === window.adminPage ? "active" : ""}" onclick="adminGoPage(${i})">${i}</button>`;
          } else if (Math.abs(i - window.adminPage) === 2) {
            ph += `<span style="color:var(--g500);padding:0 2px">…</span>`;
          }
        }
        ph += `<button class="page-btn" onclick="adminGoPage(${window.adminPage + 1})" ${window.adminPage === pages ? "disabled" : ""}>›</button>`;
      }
      document.getElementById("admin-pagination").innerHTML = ph;
    } catch (_) {
      window.showAlert("alert-list", "error", "Falha ao listar alunos no Supabase.");
    }
  };

  window.saveAluno = async function saveAlunoSupabase() {
    const ra = document.getElementById("f-ra").value.trim();
    const nome = document.getElementById("f-nome").value.trim().toUpperCase();
    const curso = document.getElementById("f-curso").value;
    const turma = document.getElementById("f-turma").value;
    if (!ra || !nome || !curso || !turma) {
      window.showAlert("alert-form", "error", "RA, Nome, Curso e Turma são obrigatórios.");
      return;
    }
    const payload = {
      ra,
      nome,
      nascimento: document.getElementById("f-nasc").value.trim(),
      email_aluno: document.getElementById("f-email").value.trim(),
      curso,
      turma,
      turma_label: window.TURMA_LABELS[turma] || turma,
      turno: document.getElementById("f-turno").value,
      fase: document.getElementById("f-fase").value.trim(),
      tipo: document.getElementById("f-tipo").value,
      nome_pai: document.getElementById("f-pai").value.trim().toUpperCase(),
      nome_mae: document.getElementById("f-mae").value.trim().toUpperCase(),
      nome_financeiro: document.getElementById("f-fin").value.trim().toUpperCase(),
      nome_pedagogico: document.getElementById("f-ped").value.trim().toUpperCase(),
      email_pedagogico: document.getElementById("f-email-ped").value.trim(),
      celular: document.getElementById("f-celular").value.trim(),
      fone_resid: document.getElementById("f-fone-r").value.trim(),
      fone_com: document.getElementById("f-fone-c").value.trim(),
    };
    const { error } = await supabase.from("alunos").upsert(payload, { onConflict: "ra" });
    if (error) {
      window.showAlert("alert-form", "error", "Falha ao salvar aluno no Supabase.");
      return;
    }
    window.showAlert("alert-form", "success", `Aluno ${nome} salvo com sucesso.`);
    window.clearForm();
    await refreshDataAfterMutation();
    await window.renderAdminList();
  };

  window.deleteAluno = async function deleteAlunoSupabase(idx) {
    const aluno = window.ALUNOS[idx];
    if (!aluno) return;
    if (!confirm(`Excluir ${aluno.nome}? Esta ação não pode ser desfeita.`)) return;
    const { error } = await supabase.from("alunos").delete().eq("ra", aluno.ra);
    if (error) {
      window.showAlert("alert-list", "error", "Falha ao excluir aluno no Supabase.");
      return;
    }
    window.showAlert("alert-list", "success", "Aluno excluído com sucesso.");
    await refreshDataAfterMutation();
    await window.renderAdminList();
  };

  window.renderUserList = async function renderUserListSupabase() {
    try {
      if (!usersLoaded) await fetchUsers();
      const q = window.norm((document.getElementById("user-search")?.value || "").trim());
      const entries = Object.entries(window.USERS || {})
        .filter(([username, user]) => !q || window.norm(username).includes(q) || window.norm(user.name).includes(q))
        .sort((a, b) => a[0].localeCompare(b[0], "pt"));
      const body = document.getElementById("users-table-body");
      if (!body) return;
      body.innerHTML = entries
        .map(([username, user]) => `
    <tr>
      <td><strong>${username}</strong></td>
      <td>${user.name}</td>
      <td>${user.role === "admin" ? "Administrador" : "Usuário"}</td>
      <td>
        <button class="edit-row-btn" onclick="editUser('${username}')">Editar</button>
        <button class="del-row-btn" onclick="deleteUser('${username}')">Excluir</button>
      </td>
    </tr>
  `)
        .join("");
    } catch (_) {
      window.showAlert("alert-users-list", "error", "Falha ao listar usuários no Supabase.");
    }
  };

  window.saveUser = async function saveUserSupabase() {
    const username = document.getElementById("u-username").value.trim().toLowerCase();
    const name = document.getElementById("u-name").value.trim();
    const password = document.getElementById("u-pass").value.trim();
    const role = document.getElementById("u-role").value;
    const editing = document.getElementById("btn-save-user").getAttribute("data-edit-username");
    if (!username || !name || !password || !role) {
      window.showAlert("alert-users-form", "error", "Usuário, nome, senha e perfil são obrigatórios.");
      return;
    }
    const targetUsername = editing || username;
    const { error } = await supabase.rpc("app_upsert_user_secure", {
      p_username: targetUsername,
      p_name: name,
      p_role: role,
      p_password: password,
    });
    if (error) {
      window.showAlert("alert-users-form", "error", "Falha ao salvar usuário no Supabase.");
      return;
    }
    usersLoaded = false;
    await fetchUsers();
    window.clearUserForm();
    await window.renderUserList();
    window.showAlert("alert-users-form", "success", editing ? "Usuário atualizado com sucesso." : "Usuário cadastrado com sucesso.");
  };

  window.deleteUser = async function deleteUserSupabase(username) {
    if (username === window.currentUser) {
      window.showAlert("alert-users-list", "error", "Você não pode excluir o usuário atualmente logado.");
      return;
    }
    if (!confirm(`Excluir o usuário ${username}?`)) return;
    const { error } = await supabase.rpc("app_delete_user_secure", { p_username: username });
    if (error) {
      window.showAlert("alert-users-list", "error", "Falha ao excluir usuário no Supabase.");
      return;
    }
    usersLoaded = false;
    await fetchUsers();
    await window.renderUserList();
    window.clearUserForm();
    window.showAlert("alert-users-list", "success", "Usuário excluído com sucesso.");
  };

  async function bootstrap() {
    // Disable previous local session behavior.
    sessionStorage.removeItem("enau_user");
    window.USERS = {};

    if (!restoreSession()) return;
    try {
      await window.showApp();
      if (sessionUser?.role === "admin") {
        await fetchUsers();
      }
    } catch (_) {
      window.doLogout();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();
