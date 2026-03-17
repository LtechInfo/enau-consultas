begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

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
  v_username := lower(trim(coalesce(p_username, '')));

  if v_username = '' or coalesce(p_password, '') = '' then
    return query select false::boolean, null::uuid, null::text, null::text, null::text, null::boolean, null::uuid, 'invalid_input'::text, 'Informe usuário e senha.'::text, 0::integer;
    return;
  end if;

  select u.*
    into v_user
  from public.app_users u
  where u.username = v_username
  limit 1;

  if not found then
    insert into public.app_login_audit (user_id, username, success, reason, origin)
    values (null, v_username, false, 'user_not_found', p_origin);

    return query select false::boolean, null::uuid, null::text, null::text, null::text, null::boolean, null::uuid, 'invalid_credentials'::text, 'Usuário ou senha inválidos.'::text, 0::integer;
    return;
  end if;

  if not v_user.is_active then
    insert into public.app_login_audit (user_id, username, success, reason, origin)
    values (v_user.id, v_username, false, 'inactive_user', p_origin);

    return query select false::boolean, null::uuid, null::text, null::text, null::text, null::boolean, null::uuid, 'inactive_user'::text, 'Usuário inativo. Procure um administrador.'::text, 0::integer;
    return;
  end if;

  if v_user.lock_until is not null and v_user.lock_until > now() then
    v_lock_seconds := greatest(1, ceil(extract(epoch from (v_user.lock_until - now())))::integer);

    insert into public.app_login_audit (user_id, username, success, reason, origin)
    values (v_user.id, v_username, false, 'locked', p_origin);

    return query
    select false::boolean, null::uuid, null::text, null::text, null::text, null::boolean, null::uuid,
           'locked'::text,
           'Conta temporariamente bloqueada. Tente novamente em alguns minutos.'::text,
           v_lock_seconds::integer;
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
    select false::boolean, null::uuid, null::text, null::text, null::text, null::boolean, null::uuid,
           'invalid_credentials'::text,
           case
             when v_lock_minutes > 0 then 'Muitas tentativas inválidas. Conta bloqueada temporariamente.'
             else 'Usuário ou senha inválidos.'
           end::text,
           case when v_lock_minutes > 0 then (v_lock_minutes * 60) else 0 end::integer;
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

  insert into public.app_sessions (user_id, session_token, origin, expires_at)
  values (v_user.id, v_token, p_origin, now() + make_interval(hours => v_hours));

  insert into public.app_login_audit (user_id, username, success, reason, origin)
  values (v_user.id, v_username, true, 'ok', p_origin);

  return query
  select
    true::boolean,
    v_user.id::uuid,
    v_user.username::text,
    v_user.full_name::text,
    v_user.role::text,
    v_user.must_change_password::boolean,
    v_token::uuid,
    null::text,
    null::text,
    0::integer;
end;
$$;

grant execute on function public.app_login(text, text, text, integer) to anon, authenticated;

update public.app_users
set password_hash = extensions.crypt('admin123', extensions.gen_salt('bf', 10)),
    must_change_password = true,
    failed_attempts = 0,
    lock_until = null,
    is_active = true
where username = 'admin';

insert into public.app_users (username, full_name, password_hash, role, must_change_password, is_active)
select 'admin', 'Administrador', extensions.crypt('admin123', extensions.gen_salt('bf', 10)), 'admin', true, true
where not exists (select 1 from public.app_users where username = 'admin');

commit;
