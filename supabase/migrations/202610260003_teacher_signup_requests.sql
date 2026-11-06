create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_school_id uuid;
  requested_portal text;
  application_reason text;
begin
  insert into public.profiles(id, full_name, email, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', 'New user'),
    new.email,
    new.raw_user_meta_data->>'phone'
  )
  on conflict (id) do nothing;

  requested_portal := new.raw_user_meta_data->>'requested_portal';
  application_reason := nullif(trim(new.raw_user_meta_data->>'application_reason'), '');

  if requested_portal in ('school_admin', 'teacher') then
    begin
      requested_school_id :=
        (new.raw_user_meta_data->>'requested_school_id')::uuid;
    exception when invalid_text_representation then
      requested_school_id := null;
    end;

    if requested_school_id is not null and exists (
      select 1 from public.schools
      where id = requested_school_id and status = 'active'
    ) then
      if requested_portal = 'school_admin' then
        insert into public.school_admin_requests(
          school_id, applicant_user_id, reason
        )
        values (requested_school_id, new.id, application_reason)
        on conflict (school_id, applicant_user_id) do nothing;
      else
        insert into public.teacher_applications(
          school_id, user_id, qualifications
        )
        values (
          requested_school_id,
          new.id,
          jsonb_build_object('application_reason', application_reason)
        )
        on conflict (school_id, user_id) do nothing;
      end if;
    end if;
  end if;

  return new;
end;
$$;
