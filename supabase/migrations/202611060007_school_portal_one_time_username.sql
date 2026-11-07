alter table public.portal_login_credentials
  add column if not exists username_login_used_at timestamptz;

update public.portal_login_credentials
set username_login_used_at = now()
where status = 'approved'
  and username_login_used_at is null;

create or replace function public.create_school_portal_login_session(
  p_token_hash text,
  p_user_id uuid,
  p_school_id uuid,
  p_role text,
  p_expires_at timestamptz,
  p_username_login boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_token_hash is null
    or p_user_id is null
    or p_school_id is null
    or p_role not in ('student', 'parent', 'teacher', 'principal')
    or p_expires_at <= now() then
    raise exception 'Invalid portal session parameters';
  end if;

  if p_username_login then
    update public.portal_login_credentials
    set username_login_used_at = now()
    where user_id = p_user_id
      and school_id = p_school_id
      and requested_role = p_role
      and status = 'approved'
      and username_login_used_at is null;
  else
    update public.portal_login_credentials
    set username_login_used_at = coalesce(username_login_used_at, now())
    where user_id = p_user_id
      and school_id = p_school_id
      and requested_role = p_role
      and status = 'approved';
  end if;

  if not found then
    return false;
  end if;

  insert into public.portal_login_sessions(
    token_hash, user_id, school_id, requested_role, expires_at
  )
  values (
    p_token_hash, p_user_id, p_school_id, p_role, p_expires_at
  );

  return true;
end;
$$;

revoke all on function public.create_school_portal_login_session(
  text, uuid, uuid, text, timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.create_school_portal_login_session(
  text, uuid, uuid, text, timestamptz, boolean
) to service_role;
