-- ENAU Consultas: schema + security + helper functions
-- Run in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.alunos (
  id bigserial primary key,
  ra text not null unique,
  nome text not null,
  nascimento text,
  email_aluno text,
  curso text not null,
  turno text,
  fase text,
  turma text not null,
  turma_label text,
  nome_financeiro text,
  nome_pedagogico text,
  email_pedagogico text,
  nome_pai text,
  nome_mae text,
  tipo text,
  fone_resid text,
  fone_com text,
  celular text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_alunos_nome on public.alunos (nome);
create index if not exists idx_alunos_turma on public.alunos (turma);
create index if not exists idx_alunos_curso on public.alunos (curso);

create table if not exists public.usuarios_sistema (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  name text not null,
  role text not null check (role in ('admin', 'user')),
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_usuarios_username on public.usuarios_sistema (username);
create index if not exists idx_usuarios_role on public.usuarios_sistema (role);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_alunos_updated_at on public.alunos;
create trigger trg_alunos_updated_at
before update on public.alunos
for each row execute function public.set_updated_at();

drop trigger if exists trg_usuarios_updated_at on public.usuarios_sistema;
create trigger trg_usuarios_updated_at
before update on public.usuarios_sistema
for each row execute function public.set_updated_at();

alter table public.alunos enable row level security;
alter table public.usuarios_sistema enable row level security;

drop policy if exists alunos_read_auth on public.alunos;
create policy alunos_read_auth
on public.alunos
for select
to authenticated
using (true);

drop policy if exists alunos_write_admin on public.alunos;
create policy alunos_write_admin
on public.alunos
for all
to authenticated
using (
  coalesce((auth.jwt() ->> 'app_role'), '') = 'admin'
)
with check (
  coalesce((auth.jwt() ->> 'app_role'), '') = 'admin'
);

drop policy if exists usuarios_read_admin on public.usuarios_sistema;
create policy usuarios_read_admin
on public.usuarios_sistema
for select
to authenticated
using (
  coalesce((auth.jwt() ->> 'app_role'), '') = 'admin'
);

drop policy if exists usuarios_write_admin on public.usuarios_sistema;
create policy usuarios_write_admin
on public.usuarios_sistema
for all
to authenticated
using (
  coalesce((auth.jwt() ->> 'app_role'), '') = 'admin'
)
with check (
  coalesce((auth.jwt() ->> 'app_role'), '') = 'admin'
);

create or replace function public.app_list_users_safe()
returns table (
  username text,
  name text,
  role text
)
language sql
security definer
set search_path = public
as $$
  select u.username, u.name, u.role
  from public.usuarios_sistema u
  where coalesce((auth.jwt() ->> 'app_role'), '') = 'admin'
  order by u.username;
$$;

revoke all on function public.app_list_users_safe() from public;
grant execute on function public.app_list_users_safe() to authenticated;

create or replace function public.app_upsert_user_secure(
  p_username text,
  p_name text,
  p_role text,
  p_password text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce((auth.jwt() ->> 'app_role'), '') <> 'admin' then
    raise exception 'forbidden';
  end if;

  insert into public.usuarios_sistema (username, name, role, password_hash)
  values (
    lower(trim(p_username)),
    trim(p_name),
    p_role,
    crypt(p_password, gen_salt('bf'))
  )
  on conflict (username) do update set
    name = excluded.name,
    role = excluded.role,
    password_hash = excluded.password_hash;
end;
$$;

revoke all on function public.app_upsert_user_secure(text, text, text, text) from public;
grant execute on function public.app_upsert_user_secure(text, text, text, text) to authenticated;

create or replace function public.app_delete_user_secure(p_username text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce((auth.jwt() ->> 'app_role'), '') <> 'admin' then
    raise exception 'forbidden';
  end if;

  delete from public.usuarios_sistema
  where username = lower(trim(p_username));
end;
$$;

revoke all on function public.app_delete_user_secure(text) from public;
grant execute on function public.app_delete_user_secure(text) to authenticated;

create or replace function public.app_auth_username(
  p_username text,
  p_password text
)
returns table (
  user_id uuid,
  username text,
  name text,
  role text
)
language sql
security definer
set search_path = public
as $$
  select u.id, u.username, u.name, u.role
  from public.usuarios_sistema u
  where u.username = lower(trim(p_username))
    and u.password_hash = crypt(p_password, u.password_hash)
  limit 1;
$$;

revoke all on function public.app_auth_username(text, text) from public;
grant execute on function public.app_auth_username(text, text) to anon, authenticated;

-- Seed minimum users (run once in empty environments)
insert into public.usuarios_sistema (username, name, role, password_hash)
values
  ('admin', 'Administrador', 'admin', crypt('admin123', gen_salt('bf'))),
  ('enau', 'Secretaria ENAU', 'user', crypt('enau2026', gen_salt('bf')))
on conflict (username) do nothing;

