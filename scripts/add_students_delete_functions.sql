begin;

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

grant execute on function public.app_students_delete_all(uuid) to anon, authenticated;
grant execute on function public.app_students_delete_batch(uuid, text[]) to anon, authenticated;

commit;
