begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.app_users (
  id uuid primary key default extensions.gen_random_uuid(),
  username text not null,
  full_name text not null,
  password_hash text not null,
  role text not null default 'user' check (role in ('admin', 'user')),
  is_active boolean not null default true,
  must_change_password boolean not null default true,
  failed_attempts integer not null default 0,
  lock_until timestamptz,
  last_login_at timestamptz,
  last_login_origin text,
  password_changed_at timestamptz not null default now(),
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_users add column if not exists is_active boolean not null default true;
alter table public.app_users add column if not exists must_change_password boolean not null default true;
alter table public.app_users add column if not exists failed_attempts integer not null default 0;
alter table public.app_users add column if not exists lock_until timestamptz;
alter table public.app_users add column if not exists last_login_at timestamptz;
alter table public.app_users add column if not exists last_login_origin text;
alter table public.app_users add column if not exists password_changed_at timestamptz not null default now();
alter table public.app_users add column if not exists created_by uuid references public.app_users(id) on delete set null;
alter table public.app_users add column if not exists created_at timestamptz not null default now();
alter table public.app_users add column if not exists updated_at timestamptz not null default now();

update public.app_users
set username = lower(trim(username))
where username <> lower(trim(username));

delete from public.app_users a
using public.app_users b
where a.username = b.username
  and a.ctid < b.ctid;

create unique index if not exists ux_app_users_username on public.app_users (username);
create index if not exists idx_app_users_role on public.app_users (role);
create index if not exists idx_app_users_active on public.app_users (is_active);

create table if not exists public.app_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  session_token uuid not null unique default extensions.gen_random_uuid(),
  origin text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz not null default now(),
  is_revoked boolean not null default false,
  revoked_at timestamptz
);

create index if not exists idx_app_sessions_user_id on public.app_sessions (user_id);
create index if not exists idx_app_sessions_valid on public.app_sessions (session_token, is_revoked, expires_at);

create table if not exists public.app_login_audit (
  id bigserial primary key,
  user_id uuid references public.app_users(id) on delete set null,
  username text,
  success boolean not null,
  reason text,
  origin text,
  created_at timestamptz not null default now()
);

create index if not exists idx_app_login_audit_user_id on public.app_login_audit (user_id, created_at desc);
create index if not exists idx_app_login_audit_username on public.app_login_audit (username, created_at desc);

create table if not exists public.students (
  ra text primary key,
  nome text not null,
  nascimento text,
  email_aluno text,
  curso text,
  turma text,
  turno text,
  fase text,
  tipo text,
  nome_pai text,
  nome_mae text,
  nome_financeiro text,
  nome_pedagogico text,
  email_pedagogico text,
  celular text,
  fone_resid text,
  fone_com text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  imported_at timestamptz
);

alter table public.students add column if not exists created_at timestamptz not null default now();
alter table public.students add column if not exists updated_at timestamptz not null default now();
alter table public.students add column if not exists imported_at timestamptz;

create index if not exists idx_students_nome on public.students (nome);
create index if not exists idx_students_turma on public.students (turma);
create index if not exists idx_students_curso on public.students (curso);
create index if not exists idx_students_nome_mae on public.students (nome_mae);
create index if not exists idx_students_nome_pai on public.students (nome_pai);

create table if not exists public.import_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  file_name text,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  total_rows integer not null default 0,
  new_count integer not null default 0,
  updated_count integer not null default 0,
  unchanged_count integer not null default 0,
  invalid_count integer not null default 0
);

create index if not exists idx_import_runs_created_at on public.import_runs (created_at desc);
create index if not exists idx_import_runs_created_by on public.import_runs (created_by);

create table if not exists public.import_rows (
  id bigserial primary key,
  run_id uuid not null references public.import_runs(id) on delete cascade,
  row_number integer not null,
  ra text,
  status text not null check (status in ('new', 'updated', 'unchanged', 'invalid')),
  reason text,
  changed_fields text[] not null default '{}',
  original_row jsonb,
  normalized_row jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_import_rows_run_id on public.import_rows (run_id, row_number);
create index if not exists idx_import_rows_status on public.import_rows (status);

create or replace function public.app_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_app_users_updated_at on public.app_users;
create trigger trg_app_users_updated_at
before update on public.app_users
for each row execute function public.app_touch_updated_at();

drop trigger if exists trg_students_updated_at on public.students;
create trigger trg_students_updated_at
before update on public.students
for each row execute function public.app_touch_updated_at();

create or replace function public.app_norm_username(p_username text)
returns text
language sql
immutable
as $$
  select lower(trim(coalesce(p_username, '')));
$$;

create or replace function public.app_password_valid(p_password text)
returns boolean
language sql
immutable
as $$
  select
    length(coalesce(p_password, '')) >= 8
    and coalesce(p_password, '') ~ '[A-Za-z]'
    and coalesce(p_password, '') ~ '[0-9]';
$$;

create or replace function public.app_hash_password(p_password text)
returns text
language sql
security definer
set search_path = public, extensions
as $$
  select extensions.crypt(p_password, extensions.gen_salt('bf', 10));
$$;

create or replace function public.app_normalize_turno(p_turno text)
returns text
language sql
immutable
as $$
  select case
    when upper(trim(coalesce(p_turno, ''))) in ('M', 'MANHA', 'MATUTINO') then 'M'
    when upper(trim(coalesce(p_turno, ''))) in ('MEV', 'INTEGRAL') then 'MeV'
    when upper(trim(coalesce(p_turno, ''))) = '' then 'V'
    else 'V'
  end;
$$;

create or replace function public.app_normalize_tipo(p_tipo text)
returns text
language sql
immutable
as $$
  select case
    when upper(trim(coalesce(p_tipo, ''))) like '%CALOU%' then 'CALOURO'
    when upper(trim(coalesce(p_tipo, ''))) like '%VETER%' then 'VETERANO'
    when trim(coalesce(p_tipo, '')) = '' then 'VETERANO'
    else upper(trim(p_tipo))
  end;
$$;
create or replace function public.app_require_session(
  p_session_token uuid,
  p_require_admin boolean default false
)
returns public.app_users
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users;
begin
  if p_session_token is null then
    raise exception 'Sessão inválida ou expirada.';
  end if;

  select u.*
    into v_user
  from public.app_sessions s
  join public.app_users u on u.id = s.user_id
  where s.session_token = p_session_token
    and s.is_revoked = false
    and s.expires_at > now()
    and u.is_active = true
  limit 1;

  if not found then
    raise exception 'Sessão inválida ou expirada.';
  end if;

  if p_require_admin and v_user.role <> 'admin' then
    raise exception 'Acesso negado: perfil administrador obrigatório.';
  end if;

  update public.app_sessions
     set last_used_at = now()
   where session_token = p_session_token
     and is_revoked = false;

  return v_user;
end;
$$;

create or replace function public.app_session_me(
  p_session_token uuid
)
returns table (
  user_id uuid,
  username text,
  full_name text,
  role text,
  must_change_password boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users;
begin
  v_user := public.app_require_session(p_session_token, false);

  return query
  select
    v_user.id,
    v_user.username,
    v_user.full_name,
    v_user.role,
    v_user.must_change_password;
end;
$$;

drop function if exists public.app_login(text, text);
drop function if exists public.app_login(text, text, text);
drop function if exists public.app_login(text, text, text, integer);
create or replace function public.app_login(
  p_username text,
  p_password text,
  p_origin text default null,
  p_session_hours integer default 12
)
returns table (
  ok boolean,
  user_id uuid,
  username text,
  full_name text,
  role text,
  must_change_password boolean,
  session_token uuid,
  error_code text,
  error_message text,
  lock_seconds integer
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_username text;
  v_user public.app_users;
  v_token uuid;
  v_failed integer;
  v_lock_minutes integer;
  v_lock_seconds integer;
  v_hours integer;
begin
  v_username := public.app_norm_username(p_username);

  if v_username = '' or coalesce(p_password, '') = '' then
    return query select false, null::uuid, null::text, null::text, null::text, null::boolean, null::uuid, 'invalid_input', 'Informe usuário e senha.', 0;
    return;
  end if;

  select *
    into v_user
  from public.app_users u
  where u.username = v_username
  limit 1;

  if not found then
    insert into public.app_login_audit (user_id, username, success, reason, origin)
    values (null, v_username, false, 'user_not_found', p_origin);

    return query select false, null::uuid, null::text, null::text, null::text, null::boolean, null::uuid, 'invalid_credentials', 'Usuário ou senha inválidos.', 0;
    return;
  end if;

  if not v_user.is_active then
    insert into public.app_login_audit (user_id, username, success, reason, origin)
    values (v_user.id, v_username, false, 'inactive_user', p_origin);

    return query select false, null::uuid, null::text, null::text, null::text, null::boolean, null::uuid, 'inactive_user', 'Usuário inativo. Procure um administrador.', 0;
    return;
  end if;

  if v_user.lock_until is not null and v_user.lock_until > now() then
    v_lock_seconds := greatest(1, ceil(extract(epoch from (v_user.lock_until - now())))::integer);

    insert into public.app_login_audit (user_id, username, success, reason, origin)
    values (v_user.id, v_username, false, 'locked', p_origin);

    return query
    select false, null::uuid, null::text, null::text, null::text, null::boolean, null::uuid,
           'locked',
           'Conta temporariamente bloqueada. Tente novamente em alguns minutos.',
           v_lock_seconds;
    return;
  end if;

  if v_user.password_hash <> extensions.crypt(p_password, v_user.password_hash) then
    v_failed := coalesce(v_user.failed_attempts, 0) + 1;
    v_lock_minutes := case
      when v_failed < 5 then 0
      when v_failed = 5 then 1
      when v_failed = 6 then 2
      when v_failed = 7 then 5
      else least(60, 10 + (v_failed - 7) * 5)
    end;

    update public.app_users
       set failed_attempts = v_failed,
           lock_until = case when v_lock_minutes > 0 then now() + make_interval(mins => v_lock_minutes) else null end
     where id = v_user.id;

    insert into public.app_login_audit (user_id, username, success, reason, origin)
    values (v_user.id, v_username, false, 'invalid_password', p_origin);

    return query
    select false, null::uuid, null::text, null::text, null::text, null::boolean, null::uuid,
           'invalid_credentials',
           case
             when v_lock_minutes > 0 then 'Muitas tentativas inválidas. Conta bloqueada temporariamente.'
             else 'Usuário ou senha inválidos.'
           end,
           case when v_lock_minutes > 0 then v_lock_minutes * 60 else 0 end;
    return;
  end if;

  v_hours := greatest(1, least(coalesce(p_session_hours, 12), 72));

  update public.app_users
     set failed_attempts = 0,
         lock_until = null,
         last_login_at = now(),
         last_login_origin = p_origin
   where id = v_user.id;

  v_token := extensions.gen_random_uuid();

  insert into public.app_sessions (
    user_id,
    session_token,
    origin,
    expires_at
  )
  values (
    v_user.id,
    v_token,
    p_origin,
    now() + make_interval(hours => v_hours)
  );

  insert into public.app_login_audit (user_id, username, success, reason, origin)
  values (v_user.id, v_username, true, 'ok', p_origin);

  return query
  select
    true,
    v_user.id,
    v_user.username,
    v_user.full_name,
    v_user.role,
    v_user.must_change_password,
    v_token,
    null::text,
    null::text,
    0;
end;
$$;

create or replace function public.app_logout(
  p_session_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_session_token is null then
    return false;
  end if;

  update public.app_sessions
     set is_revoked = true,
         revoked_at = now()
   where session_token = p_session_token
     and is_revoked = false;

  return found;
end;
$$;

drop function if exists public.app_change_password_first_login(uuid, text, text);
create or replace function public.app_change_password_first_login(
  p_session_token uuid,
  p_old_password text,
  p_new_password text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users;
begin
  v_user := public.app_require_session(p_session_token, false);

  if coalesce(p_old_password, '') = '' or coalesce(p_new_password, '') = '' then
    raise exception 'Informe a senha atual e a nova senha.';
  end if;

  if v_user.password_hash <> extensions.crypt(p_old_password, v_user.password_hash) then
    raise exception 'Senha atual incorreta.';
  end if;

  if not public.app_password_valid(p_new_password) then
    raise exception 'A nova senha deve ter ao menos 8 caracteres, incluindo letras e números.';
  end if;

  if p_old_password = p_new_password then
    raise exception 'A nova senha deve ser diferente da senha atual.';
  end if;

  update public.app_users
     set password_hash = public.app_hash_password(p_new_password),
         must_change_password = false,
         password_changed_at = now(),
         failed_attempts = 0,
         lock_until = null
   where id = v_user.id;

  update public.app_sessions
     set is_revoked = true,
         revoked_at = now()
   where user_id = v_user.id
     and session_token <> p_session_token
     and is_revoked = false;

  return true;
end;
$$;
drop function if exists public.app_create_user(text, text, text, text);
drop function if exists public.app_update_user(uuid, text, text, text);
drop function if exists public.app_delete_user(uuid);

create or replace function public.app_list_users_secure(
  p_session_token uuid
)
returns table (
  id uuid,
  username text,
  full_name text,
  role text,
  is_active boolean,
  must_change_password boolean,
  last_login_at timestamptz,
  failed_attempts integer,
  lock_until timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin public.app_users;
begin
  v_admin := public.app_require_session(p_session_token, true);

  return query
  select
    u.id,
    u.username,
    u.full_name,
    u.role,
    u.is_active,
    u.must_change_password,
    u.last_login_at,
    u.failed_attempts,
    u.lock_until
  from public.app_users u
  where u.is_active = true
  order by u.username;
end;
$$;

create or replace function public.app_create_user_secure(
  p_session_token uuid,
  p_username text,
  p_password text,
  p_full_name text,
  p_role text default 'user'
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin public.app_users;
  v_username text;
  v_role text;
  v_id uuid;
begin
  v_admin := public.app_require_session(p_session_token, true);
  v_username := public.app_norm_username(p_username);

  if v_username = '' then
    raise exception 'Usuário é obrigatório.';
  end if;

  if trim(coalesce(p_full_name, '')) = '' then
    raise exception 'Nome é obrigatório.';
  end if;

  if not public.app_password_valid(p_password) then
    raise exception 'Senha fraca. Use ao menos 8 caracteres, incluindo letras e números.';
  end if;

  v_role := case when lower(trim(coalesce(p_role, 'user'))) = 'admin' then 'admin' else 'user' end;

  insert into public.app_users (
    username,
    full_name,
    password_hash,
    role,
    must_change_password,
    created_by
  )
  values (
    v_username,
    trim(p_full_name),
    public.app_hash_password(p_password),
    v_role,
    true,
    v_admin.id
  )
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    raise exception 'Usuário % já existe.', v_username;
end;
$$;

create or replace function public.app_update_user_secure(
  p_session_token uuid,
  p_user_id uuid,
  p_full_name text,
  p_role text,
  p_new_password text default null,
  p_is_active boolean default true,
  p_force_password_change boolean default null
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin public.app_users;
  v_target public.app_users;
  v_role text;
  v_admin_count integer;
begin
  v_admin := public.app_require_session(p_session_token, true);

  select * into v_target
  from public.app_users
  where id = p_user_id
  limit 1;

  if not found then
    raise exception 'Usuário não encontrado.';
  end if;

  if trim(coalesce(p_full_name, '')) = '' then
    raise exception 'Nome é obrigatório.';
  end if;

  v_role := case when lower(trim(coalesce(p_role, 'user'))) = 'admin' then 'admin' else 'user' end;

  if v_target.role = 'admin' and v_role <> 'admin' then
    select count(*)
      into v_admin_count
    from public.app_users
    where role = 'admin'
      and is_active = true;

    if v_admin_count <= 1 then
      raise exception 'Não é permitido remover o último administrador ativo.';
    end if;
  end if;

  if p_new_password is not null and trim(p_new_password) <> '' and not public.app_password_valid(p_new_password) then
    raise exception 'Senha fraca. Use ao menos 8 caracteres, incluindo letras e números.';
  end if;

  if v_admin.id = p_user_id and v_role <> 'admin' then
    raise exception 'Você não pode remover seu próprio perfil de administrador na sessão atual.';
  end if;

  update public.app_users
     set full_name = trim(p_full_name),
         role = v_role,
         is_active = coalesce(p_is_active, true),
         password_hash = case
           when p_new_password is not null and trim(p_new_password) <> '' then public.app_hash_password(p_new_password)
           else password_hash
         end,
         must_change_password = case
           when p_force_password_change is not null then p_force_password_change
           when p_new_password is not null and trim(p_new_password) <> '' then true
           else must_change_password
         end,
         password_changed_at = case
           when p_new_password is not null and trim(p_new_password) <> '' then now()
           else password_changed_at
         end,
         failed_attempts = case
           when p_new_password is not null and trim(p_new_password) <> '' then 0
           else failed_attempts
         end,
         lock_until = case
           when p_new_password is not null and trim(p_new_password) <> '' then null
           else lock_until
         end
   where id = p_user_id;

  return true;
end;
$$;

create or replace function public.app_delete_user_secure(
  p_session_token uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin public.app_users;
  v_target public.app_users;
  v_admin_count integer;
begin
  v_admin := public.app_require_session(p_session_token, true);

  if v_admin.id = p_user_id then
    raise exception 'Não é permitido excluir o próprio usuário logado.';
  end if;

  select * into v_target
  from public.app_users
  where id = p_user_id
  limit 1;

  if not found then
    return false;
  end if;

  if v_target.role = 'admin' then
    select count(*)
      into v_admin_count
    from public.app_users
    where role = 'admin'
      and is_active = true;

    if v_admin_count <= 1 then
      raise exception 'Não é permitido excluir o último administrador ativo.';
    end if;
  end if;

  delete from public.app_users where id = p_user_id;
  return true;
end;
$$;
create or replace function public.app_students_list(
  p_session_token uuid,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0,
  p_turma text default null,
  p_curso text default null
)
returns table (
  ra text,
  nome text,
  nascimento text,
  email_aluno text,
  curso text,
  turma text,
  turno text,
  fase text,
  tipo text,
  nome_pai text,
  nome_mae text,
  nome_financeiro text,
  nome_pedagogico text,
  email_pedagogico text,
  celular text,
  fone_resid text,
  fone_com text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users;
  v_search text;
  v_limit integer;
  v_offset integer;
begin
  v_user := public.app_require_session(p_session_token, false);
  v_search := lower(trim(coalesce(p_search, '')));
  v_limit := greatest(1, least(coalesce(p_limit, 50), 500));
  v_offset := greatest(0, coalesce(p_offset, 0));

  return query
  select
    s.ra,
    s.nome,
    s.nascimento,
    s.email_aluno,
    s.curso,
    s.turma,
    s.turno,
    s.fase,
    s.tipo,
    s.nome_pai,
    s.nome_mae,
    s.nome_financeiro,
    s.nome_pedagogico,
    s.email_pedagogico,
    s.celular,
    s.fone_resid,
    s.fone_com,
    s.updated_at
  from public.students s
  where (
    v_search = ''
    or lower(coalesce(s.nome, '')) like '%' || v_search || '%'
    or lower(coalesce(s.nome_mae, '')) like '%' || v_search || '%'
    or lower(coalesce(s.nome_pai, '')) like '%' || v_search || '%'
    or lower(coalesce(s.nome_financeiro, '')) like '%' || v_search || '%'
    or lower(coalesce(s.nome_pedagogico, '')) like '%' || v_search || '%'
    or lower(coalesce(s.ra, '')) like '%' || v_search || '%'
    or lower(coalesce(s.celular, '')) like '%' || v_search || '%'
    or lower(coalesce(s.fone_resid, '')) like '%' || v_search || '%'
  )
    and (trim(coalesce(p_turma, '')) = '' or s.turma = trim(p_turma))
    and (trim(coalesce(p_curso, '')) = '' or s.curso = trim(p_curso))
  order by s.nome asc, s.ra asc
  limit v_limit
  offset v_offset;
end;
$$;

create or replace function public.app_students_count(
  p_session_token uuid,
  p_search text default null,
  p_turma text default null,
  p_curso text default null
)
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users;
  v_search text;
  v_total bigint;
begin
  v_user := public.app_require_session(p_session_token, false);
  v_search := lower(trim(coalesce(p_search, '')));

  select count(*)
    into v_total
  from public.students s
  where (
    v_search = ''
    or lower(coalesce(s.nome, '')) like '%' || v_search || '%'
    or lower(coalesce(s.nome_mae, '')) like '%' || v_search || '%'
    or lower(coalesce(s.nome_pai, '')) like '%' || v_search || '%'
    or lower(coalesce(s.nome_financeiro, '')) like '%' || v_search || '%'
    or lower(coalesce(s.nome_pedagogico, '')) like '%' || v_search || '%'
    or lower(coalesce(s.ra, '')) like '%' || v_search || '%'
    or lower(coalesce(s.celular, '')) like '%' || v_search || '%'
    or lower(coalesce(s.fone_resid, '')) like '%' || v_search || '%'
  )
    and (trim(coalesce(p_turma, '')) = '' or s.turma = trim(p_turma))
    and (trim(coalesce(p_curso, '')) = '' or s.curso = trim(p_curso));

  return coalesce(v_total, 0);
end;
$$;

create or replace function public.app_student_upsert(
  p_session_token uuid,
  p_payload jsonb
)
returns table (
  action text,
  ra text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin public.app_users;
  v_existing public.students;
  v_ra text;
  v_nome text;
  v_nascimento text;
  v_email_aluno text;
  v_curso text;
  v_turma text;
  v_turno text;
  v_fase text;
  v_tipo text;
  v_nome_pai text;
  v_nome_mae text;
  v_nome_financeiro text;
  v_nome_pedagogico text;
  v_email_pedagogico text;
  v_celular text;
  v_fone_resid text;
  v_fone_com text;
  v_changed boolean;
begin
  v_admin := public.app_require_session(p_session_token, true);

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Payload inválido para aluno.';
  end if;

  v_ra := trim(coalesce(p_payload ->> 'ra', ''));
  v_nome := upper(trim(coalesce(p_payload ->> 'nome', '')));
  v_nascimento := trim(coalesce(p_payload ->> 'nascimento', ''));
  v_email_aluno := trim(coalesce(p_payload ->> 'email_aluno', ''));
  v_curso := trim(coalesce(p_payload ->> 'curso', ''));
  v_turma := trim(coalesce(p_payload ->> 'turma', ''));
  v_turno := public.app_normalize_turno(p_payload ->> 'turno');
  v_fase := trim(coalesce(p_payload ->> 'fase', ''));
  v_tipo := public.app_normalize_tipo(p_payload ->> 'tipo');
  v_nome_pai := upper(trim(coalesce(p_payload ->> 'nome_pai', '')));
  v_nome_mae := upper(trim(coalesce(p_payload ->> 'nome_mae', '')));
  v_nome_financeiro := upper(trim(coalesce(p_payload ->> 'nome_financeiro', '')));
  v_nome_pedagogico := upper(trim(coalesce(p_payload ->> 'nome_pedagogico', '')));
  v_email_pedagogico := trim(coalesce(p_payload ->> 'email_pedagogico', ''));
  v_celular := trim(coalesce(p_payload ->> 'celular', ''));
  v_fone_resid := trim(coalesce(p_payload ->> 'fone_resid', ''));
  v_fone_com := trim(coalesce(p_payload ->> 'fone_com', ''));

  if v_ra = '' then
    raise exception 'RA é obrigatório.';
  end if;

  if v_nome = '' then
    raise exception 'Nome é obrigatório.';
  end if;

  select * into v_existing
  from public.students
  where students.ra = v_ra
  for update;

  if not found then
    insert into public.students (
      ra,
      nome,
      nascimento,
      email_aluno,
      curso,
      turma,
      turno,
      fase,
      tipo,
      nome_pai,
      nome_mae,
      nome_financeiro,
      nome_pedagogico,
      email_pedagogico,
      celular,
      fone_resid,
      fone_com,
      imported_at
    ) values (
      v_ra,
      v_nome,
      nullif(v_nascimento, ''),
      nullif(v_email_aluno, ''),
      nullif(v_curso, ''),
      nullif(v_turma, ''),
      nullif(v_turno, ''),
      nullif(v_fase, ''),
      nullif(v_tipo, ''),
      nullif(v_nome_pai, ''),
      nullif(v_nome_mae, ''),
      nullif(v_nome_financeiro, ''),
      nullif(v_nome_pedagogico, ''),
      nullif(v_email_pedagogico, ''),
      nullif(v_celular, ''),
      nullif(v_fone_resid, ''),
      nullif(v_fone_com, ''),
      now()
    );

    return query select 'new'::text, v_ra;
    return;
  end if;

  v_changed :=
    (nullif(v_nome, '') is not null and v_nome is distinct from coalesce(v_existing.nome, ''))
    or (nullif(v_nascimento, '') is not null and v_nascimento is distinct from coalesce(v_existing.nascimento, ''))
    or (nullif(v_email_aluno, '') is not null and v_email_aluno is distinct from coalesce(v_existing.email_aluno, ''))
    or (nullif(v_curso, '') is not null and v_curso is distinct from coalesce(v_existing.curso, ''))
    or (nullif(v_turma, '') is not null and v_turma is distinct from coalesce(v_existing.turma, ''))
    or (nullif(v_turno, '') is not null and v_turno is distinct from coalesce(v_existing.turno, ''))
    or (nullif(v_fase, '') is not null and v_fase is distinct from coalesce(v_existing.fase, ''))
    or (nullif(v_tipo, '') is not null and v_tipo is distinct from coalesce(v_existing.tipo, ''))
    or (nullif(v_nome_pai, '') is not null and v_nome_pai is distinct from coalesce(v_existing.nome_pai, ''))
    or (nullif(v_nome_mae, '') is not null and v_nome_mae is distinct from coalesce(v_existing.nome_mae, ''))
    or (nullif(v_nome_financeiro, '') is not null and v_nome_financeiro is distinct from coalesce(v_existing.nome_financeiro, ''))
    or (nullif(v_nome_pedagogico, '') is not null and v_nome_pedagogico is distinct from coalesce(v_existing.nome_pedagogico, ''))
    or (nullif(v_email_pedagogico, '') is not null and v_email_pedagogico is distinct from coalesce(v_existing.email_pedagogico, ''))
    or (nullif(v_celular, '') is not null and v_celular is distinct from coalesce(v_existing.celular, ''))
    or (nullif(v_fone_resid, '') is not null and v_fone_resid is distinct from coalesce(v_existing.fone_resid, ''))
    or (nullif(v_fone_com, '') is not null and v_fone_com is distinct from coalesce(v_existing.fone_com, ''));

  if not v_changed then
    return query select 'unchanged'::text, v_ra;
    return;
  end if;

  update public.students
     set nome = coalesce(nullif(v_nome, ''), nome),
         nascimento = coalesce(nullif(v_nascimento, ''), nascimento),
         email_aluno = coalesce(nullif(v_email_aluno, ''), email_aluno),
         curso = coalesce(nullif(v_curso, ''), curso),
         turma = coalesce(nullif(v_turma, ''), turma),
         turno = coalesce(nullif(v_turno, ''), turno),
         fase = coalesce(nullif(v_fase, ''), fase),
         tipo = coalesce(nullif(v_tipo, ''), tipo),
         nome_pai = coalesce(nullif(v_nome_pai, ''), nome_pai),
         nome_mae = coalesce(nullif(v_nome_mae, ''), nome_mae),
         nome_financeiro = coalesce(nullif(v_nome_financeiro, ''), nome_financeiro),
         nome_pedagogico = coalesce(nullif(v_nome_pedagogico, ''), nome_pedagogico),
         email_pedagogico = coalesce(nullif(v_email_pedagogico, ''), email_pedagogico),
         celular = coalesce(nullif(v_celular, ''), celular),
         fone_resid = coalesce(nullif(v_fone_resid, ''), fone_resid),
         fone_com = coalesce(nullif(v_fone_com, ''), fone_com),
         imported_at = now()
   where students.ra = v_ra;

  return query select 'updated'::text, v_ra;
end;
$$;

create or replace function public.app_student_delete(
  p_session_token uuid,
  p_ra text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin public.app_users;
  v_ra text;
begin
  v_admin := public.app_require_session(p_session_token, true);
  v_ra := trim(coalesce(p_ra, ''));

  if v_ra = '' then
    raise exception 'RA é obrigatório para exclusão.';
  end if;

  delete from public.students
  where students.ra = v_ra;

  return found;
end;
$$;

create or replace function public.app_students_delete_all(
  p_session_token uuid
)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin public.app_users;
  v_deleted integer;
begin
  v_admin := public.app_require_session(p_session_token, true);

  delete from public.students;
  get diagnostics v_deleted = row_count;

  return coalesce(v_deleted, 0);
end;
$$;

create or replace function public.app_students_delete_batch(
  p_session_token uuid,
  p_ras text[]
)
returns table (
  requested_count integer,
  deleted_count integer,
  not_found_count integer
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin public.app_users;
  v_ras text[];
  v_requested integer := 0;
  v_deleted integer := 0;
begin
  v_admin := public.app_require_session(p_session_token, true);

  select coalesce(
    array_agg(distinct nullif(trim(regexp_replace(ra, '\\.0+$', '')), '')),
    array[]::text[]
  )
    into v_ras
  from unnest(coalesce(p_ras, array[]::text[])) as ra;

  v_requested := coalesce(array_length(v_ras, 1), 0);
  if v_requested = 0 then
    return query select 0, 0, 0;
    return;
  end if;

  delete from public.students s
  where s.ra = any(v_ras);
  get diagnostics v_deleted = row_count;

  return query
  select
    v_requested,
    coalesce(v_deleted, 0),
    greatest(v_requested - coalesce(v_deleted, 0), 0);
end;
$$;
create or replace function public.app_json_pick_text(
  p_row jsonb,
  p_keys text[]
)
returns text
language plpgsql
immutable
as $$
declare
  v_key text;
  v_value text;
begin
  if p_row is null then
    return '';
  end if;

  foreach v_key in array p_keys loop
    v_value := trim(coalesce(p_row ->> v_key, ''));
    if v_value <> '' then
      return v_value;
    end if;
  end loop;

  return '';
end;
$$;

create or replace function public.app_normalize_import_row(
  p_row jsonb
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_ra text;
  v_nome text;
  v_turma text;
begin
  v_ra := regexp_replace(
    public.app_json_pick_text(p_row, array['ra', 'RA', 'ra_filho', 'RA_FILHO']),
    '\\.0+$',
    ''
  );

  v_nome := upper(public.app_json_pick_text(p_row, array['nome', 'NOME', 'nome_filho', 'NOME_FILHO']));
  v_turma := public.app_json_pick_text(p_row, array['turma', 'TURMA']);

  return jsonb_build_object(
    'ra', trim(v_ra),
    'nome', trim(v_nome),
    'nascimento', public.app_json_pick_text(p_row, array['nascimento', 'NASCIMENTO', 'data_nascimento', 'DATA_NASCIMENTO']),
    'email_aluno', public.app_json_pick_text(p_row, array['email_aluno', 'EMAIL_ALUNO', 'email_filho', 'EMAIL_FILHO', 'email_instituicao_filho', 'EMAIL_INSTITUICAO_FILHO', 'email_instiuicao_filho', 'EMAIL_INSTIUICAO_FILHO']),
    'curso', public.app_json_pick_text(p_row, array['curso', 'CURSO']),
    'turma', trim(v_turma),
    'turno', public.app_normalize_turno(public.app_json_pick_text(p_row, array['turno', 'TURNO'])),
    'fase', public.app_json_pick_text(p_row, array['fase', 'FASE']),
    'tipo', public.app_normalize_tipo(public.app_json_pick_text(p_row, array['tipo', 'TIPO', 'calouro_veterano', 'CALOURO_VETERANO'])),
    'nome_pai', upper(public.app_json_pick_text(p_row, array['nome_pai', 'NOME_PAI'])),
    'nome_mae', upper(public.app_json_pick_text(p_row, array['nome_mae', 'NOME_MAE'])),
    'nome_financeiro', upper(public.app_json_pick_text(p_row, array['nome_financeiro', 'NOME_FINANCEIRO', 'nome_fin', 'NOME_FIN'])),
    'nome_pedagogico', upper(public.app_json_pick_text(p_row, array['nome_pedagogico', 'NOME_PEDAGOGICO', 'nome_ped', 'NOME_PED'])),
    'email_pedagogico', public.app_json_pick_text(p_row, array['email_pedagogico', 'EMAIL_PEDAGOGICO', 'email_ped', 'EMAIL_PED']),
    'celular', public.app_json_pick_text(p_row, array['celular', 'CELULAR', 'cel', 'CEL', 'cel_mae', 'CEL_MAE', 'cel_pai', 'CEL_PAI']),
    'fone_resid', public.app_json_pick_text(p_row, array['fone_resid', 'FONE_RESID', 'telefone_residencial', 'TELEFONE_RESIDENCIAL']),
    'fone_com', public.app_json_pick_text(p_row, array['fone_com', 'FONE_COM', 'telefone_comercial', 'TELEFONE_COMERCIAL'])
  );
end;
$$;

create or replace function public.app_import_preview(
  p_session_token uuid,
  p_rows jsonb
)
returns table (
  row_number integer,
  ra text,
  nome text,
  status text,
  reason text,
  changed_fields text[],
  normalized_row jsonb
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin public.app_users;
  v_item record;
  v_norm jsonb;
  v_existing public.students;
  v_ra text;
  v_nome text;
  v_changes text[];
begin
  v_admin := public.app_require_session(p_session_token, true);

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Payload de importação inválido. Envie um array JSON.';
  end if;

  for v_item in
    select value as row_data, ordinality as row_number
      from jsonb_array_elements(p_rows) with ordinality
  loop
    v_norm := public.app_normalize_import_row(v_item.row_data);
    v_ra := trim(coalesce(v_norm ->> 'ra', ''));
    v_nome := trim(coalesce(v_norm ->> 'nome', ''));

    if v_ra = '' or v_nome = '' then
      return query
      select
        v_item.row_number::integer,
        nullif(v_ra, ''),
        nullif(v_nome, ''),
        'invalid'::text,
        'RA e Nome são obrigatórios.',
        '{}'::text[],
        v_norm;
      continue;
    end if;

    select *
      into v_existing
    from public.students s
    where s.ra = v_ra
    limit 1;

    if not found then
      return query
      select
        v_item.row_number::integer,
        v_ra,
        v_nome,
        'new'::text,
        null::text,
        '{}'::text[],
        v_norm;
      continue;
    end if;

    v_changes := array[]::text[];

    if nullif(v_norm->>'nome', '') is not null and (v_norm->>'nome') is distinct from coalesce(v_existing.nome, '') then v_changes := array_append(v_changes, 'nome'); end if;
    if nullif(v_norm->>'nascimento', '') is not null and (v_norm->>'nascimento') is distinct from coalesce(v_existing.nascimento, '') then v_changes := array_append(v_changes, 'nascimento'); end if;
    if nullif(v_norm->>'email_aluno', '') is not null and (v_norm->>'email_aluno') is distinct from coalesce(v_existing.email_aluno, '') then v_changes := array_append(v_changes, 'email_aluno'); end if;
    if nullif(v_norm->>'curso', '') is not null and (v_norm->>'curso') is distinct from coalesce(v_existing.curso, '') then v_changes := array_append(v_changes, 'curso'); end if;
    if nullif(v_norm->>'turma', '') is not null and (v_norm->>'turma') is distinct from coalesce(v_existing.turma, '') then v_changes := array_append(v_changes, 'turma'); end if;
    if nullif(v_norm->>'turno', '') is not null and (v_norm->>'turno') is distinct from coalesce(v_existing.turno, '') then v_changes := array_append(v_changes, 'turno'); end if;
    if nullif(v_norm->>'fase', '') is not null and (v_norm->>'fase') is distinct from coalesce(v_existing.fase, '') then v_changes := array_append(v_changes, 'fase'); end if;
    if nullif(v_norm->>'tipo', '') is not null and (v_norm->>'tipo') is distinct from coalesce(v_existing.tipo, '') then v_changes := array_append(v_changes, 'tipo'); end if;
    if nullif(v_norm->>'nome_pai', '') is not null and (v_norm->>'nome_pai') is distinct from coalesce(v_existing.nome_pai, '') then v_changes := array_append(v_changes, 'nome_pai'); end if;
    if nullif(v_norm->>'nome_mae', '') is not null and (v_norm->>'nome_mae') is distinct from coalesce(v_existing.nome_mae, '') then v_changes := array_append(v_changes, 'nome_mae'); end if;
    if nullif(v_norm->>'nome_financeiro', '') is not null and (v_norm->>'nome_financeiro') is distinct from coalesce(v_existing.nome_financeiro, '') then v_changes := array_append(v_changes, 'nome_financeiro'); end if;
    if nullif(v_norm->>'nome_pedagogico', '') is not null and (v_norm->>'nome_pedagogico') is distinct from coalesce(v_existing.nome_pedagogico, '') then v_changes := array_append(v_changes, 'nome_pedagogico'); end if;
    if nullif(v_norm->>'email_pedagogico', '') is not null and (v_norm->>'email_pedagogico') is distinct from coalesce(v_existing.email_pedagogico, '') then v_changes := array_append(v_changes, 'email_pedagogico'); end if;
    if nullif(v_norm->>'celular', '') is not null and (v_norm->>'celular') is distinct from coalesce(v_existing.celular, '') then v_changes := array_append(v_changes, 'celular'); end if;
    if nullif(v_norm->>'fone_resid', '') is not null and (v_norm->>'fone_resid') is distinct from coalesce(v_existing.fone_resid, '') then v_changes := array_append(v_changes, 'fone_resid'); end if;
    if nullif(v_norm->>'fone_com', '') is not null and (v_norm->>'fone_com') is distinct from coalesce(v_existing.fone_com, '') then v_changes := array_append(v_changes, 'fone_com'); end if;

    if coalesce(array_length(v_changes, 1), 0) = 0 then
      return query select v_item.row_number::integer, v_ra, v_nome, 'unchanged'::text, null::text, '{}'::text[], v_norm;
    else
      return query select v_item.row_number::integer, v_ra, v_nome, 'updated'::text, null::text, v_changes, v_norm;
    end if;
  end loop;
end;
$$;
create or replace function public.app_import_confirm(
  p_session_token uuid,
  p_file_name text,
  p_rows jsonb
)
returns table (
  run_id uuid,
  total_rows integer,
  new_count integer,
  updated_count integer,
  unchanged_count integer,
  invalid_count integer
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin public.app_users;
  v_run_id uuid;
  v_preview record;
  v_result record;
  v_total integer := 0;
  v_new integer := 0;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_invalid integer := 0;
begin
  v_admin := public.app_require_session(p_session_token, true);

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Payload de importação inválido. Envie um array JSON.';
  end if;

  insert into public.import_runs (file_name, created_by)
  values (nullif(trim(coalesce(p_file_name, '')), ''), v_admin.id)
  returning id into v_run_id;

  for v_preview in
    select * from public.app_import_preview(p_session_token, p_rows)
    order by row_number
  loop
    v_total := v_total + 1;

    if v_preview.status = 'invalid' then
      v_invalid := v_invalid + 1;
      insert into public.import_rows (
        run_id,
        row_number,
        ra,
        status,
        reason,
        changed_fields,
        original_row,
        normalized_row
      ) values (
        v_run_id,
        v_preview.row_number,
        v_preview.ra,
        'invalid',
        v_preview.reason,
        coalesce(v_preview.changed_fields, '{}'::text[]),
        (p_rows -> (v_preview.row_number - 1)),
        v_preview.normalized_row
      );
      continue;
    end if;

    select * into v_result
    from public.app_student_upsert(p_session_token, v_preview.normalized_row)
    limit 1;

    if v_result.action = 'new' then
      v_new := v_new + 1;
    elsif v_result.action = 'updated' then
      v_updated := v_updated + 1;
    else
      v_unchanged := v_unchanged + 1;
    end if;

    insert into public.import_rows (
      run_id,
      row_number,
      ra,
      status,
      reason,
      changed_fields,
      original_row,
      normalized_row
    ) values (
      v_run_id,
      v_preview.row_number,
      coalesce(v_result.ra, v_preview.ra),
      coalesce(v_result.action, v_preview.status),
      v_preview.reason,
      coalesce(v_preview.changed_fields, '{}'::text[]),
      (p_rows -> (v_preview.row_number - 1)),
      v_preview.normalized_row
    );
  end loop;

  update public.import_runs
     set total_rows = v_total,
         new_count = v_new,
         updated_count = v_updated,
         unchanged_count = v_unchanged,
         invalid_count = v_invalid
   where id = v_run_id;

  return query
  select v_run_id, v_total, v_new, v_updated, v_unchanged, v_invalid;
end;
$$;

create or replace function public.app_import_runs_list(
  p_session_token uuid,
  p_limit integer default 20
)
returns table (
  id uuid,
  file_name text,
  created_at timestamptz,
  total_rows integer,
  new_count integer,
  updated_count integer,
  unchanged_count integer,
  invalid_count integer,
  created_by_name text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin public.app_users;
  v_limit integer;
begin
  v_admin := public.app_require_session(p_session_token, true);
  v_limit := greatest(1, least(coalesce(p_limit, 20), 100));

  return query
  select
    r.id,
    r.file_name,
    r.created_at,
    r.total_rows,
    r.new_count,
    r.updated_count,
    r.unchanged_count,
    r.invalid_count,
    coalesce(u.full_name, u.username, 'sistema') as created_by_name
  from public.import_runs r
  left join public.app_users u on u.id = r.created_by
  order by r.created_at desc
  limit v_limit;
end;
$$;

create or replace function public.app_import_run_report(
  p_session_token uuid,
  p_run_id uuid
)
returns table (
  row_number integer,
  ra text,
  status text,
  reason text,
  changed_fields text[],
  normalized_row jsonb
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin public.app_users;
begin
  v_admin := public.app_require_session(p_session_token, true);

  return query
  select
    r.row_number,
    r.ra,
    r.status,
    r.reason,
    r.changed_fields,
    r.normalized_row
  from public.import_rows r
  where r.run_id = p_run_id
  order by r.row_number;
end;
$$;

insert into public.app_users (
  username,
  full_name,
  password_hash,
  role,
  must_change_password
)
select
  'admin',
  'Administrador',
  public.app_hash_password('admin123'),
  'admin',
  true
where not exists (select 1 from public.app_users);

revoke all on table public.app_users from anon, authenticated;
revoke all on table public.app_sessions from anon, authenticated;
revoke all on table public.app_login_audit from anon, authenticated;
revoke all on table public.students from anon, authenticated;
revoke all on table public.import_runs from anon, authenticated;
revoke all on table public.import_rows from anon, authenticated;

alter table public.app_users enable row level security;
alter table public.app_sessions enable row level security;
alter table public.app_login_audit enable row level security;
alter table public.students enable row level security;
alter table public.import_runs enable row level security;
alter table public.import_rows enable row level security;

grant execute on function public.app_login(text, text, text, integer) to anon, authenticated;
grant execute on function public.app_logout(uuid) to anon, authenticated;
grant execute on function public.app_session_me(uuid) to anon, authenticated;
grant execute on function public.app_change_password_first_login(uuid, text, text) to anon, authenticated;
grant execute on function public.app_students_list(uuid, text, integer, integer, text, text) to anon, authenticated;
grant execute on function public.app_students_count(uuid, text, text, text) to anon, authenticated;
grant execute on function public.app_student_upsert(uuid, jsonb) to anon, authenticated;
grant execute on function public.app_student_delete(uuid, text) to anon, authenticated;
grant execute on function public.app_students_delete_all(uuid) to anon, authenticated;
grant execute on function public.app_students_delete_batch(uuid, text[]) to anon, authenticated;
grant execute on function public.app_list_users_secure(uuid) to anon, authenticated;
grant execute on function public.app_create_user_secure(uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.app_update_user_secure(uuid, uuid, text, text, text, boolean, boolean) to anon, authenticated;
grant execute on function public.app_delete_user_secure(uuid, uuid) to anon, authenticated;
grant execute on function public.app_import_preview(uuid, jsonb) to anon, authenticated;
grant execute on function public.app_import_confirm(uuid, text, jsonb) to anon, authenticated;
grant execute on function public.app_import_runs_list(uuid, integer) to anon, authenticated;
grant execute on function public.app_import_run_report(uuid, uuid) to anon, authenticated;

commit;




