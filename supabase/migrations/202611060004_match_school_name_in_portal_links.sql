create or replace function public.resolve_student_login_for_school(
  p_admission_number text,
  p_school_slug text
)
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.email
  from public.students s
  join public.schools sc on sc.id = s.school_id
  join auth.users u on u.id = s.user_id
  where upper(s.admission_number) = upper(trim(p_admission_number))
    and (
      lower(sc.slug) = lower(trim(p_school_slug))
      or lower(regexp_replace(
        sc.name,
        '[^a-zA-Z0-9]+',
        '-',
        'g'
      )) = lower(trim(p_school_slug))
    )
    and s.status = 'active'
    and sc.status = 'active'
  limit 1;
$$;

revoke all on function public.resolve_student_login_for_school(text, text)
  from public;
grant execute on function public.resolve_student_login_for_school(text, text)
  to anon, authenticated;
