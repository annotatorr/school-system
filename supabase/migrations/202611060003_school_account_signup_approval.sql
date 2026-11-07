alter table public.school_memberships
  add column if not exists member_number text;

create unique index if not exists school_memberships_school_member_number_uidx
  on public.school_memberships(school_id, member_number)
  where member_number is not null;

alter table public.guardians
  add column if not exists guardian_number text;

create unique index if not exists guardians_school_guardian_number_uidx
  on public.guardians(school_id, guardian_number)
  where guardian_number is not null;

create table if not exists public.school_account_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  requested_role text not null
    check (requested_role in ('student', 'teacher', 'parent', 'principal')),
  applicant_name text not null,
  applicant_email text not null,
  applicant_phone text,
  request_data jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  decision_notes text,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  generated_identifier text,
  created_at timestamptz not null default now(),
  unique (school_id, user_id, requested_role)
);

alter table public.school_account_requests enable row level security;
revoke all on public.school_account_requests from anon, authenticated;
grant select on public.school_account_requests to authenticated;

drop policy if exists school_account_requests_read_scope
  on public.school_account_requests;
create policy school_account_requests_read_scope
  on public.school_account_requests
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.has_school_role(
      school_id,
      array['school_admin', 'principal']::public.platform_user_role[]
    )
  );

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_school_id uuid;
  requested_school_slug text;
  requested_portal text;
  application_reason text;
  request_phone text;
begin
  request_phone := nullif(trim(new.raw_user_meta_data->>'phone'), '');

  insert into public.profiles(id, full_name, email, phone)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), 'New user'),
    new.email,
    request_phone
  )
  on conflict (id) do nothing;

  requested_portal := new.raw_user_meta_data->>'requested_portal';
  application_reason := nullif(trim(new.raw_user_meta_data->>'application_reason'), '');

  if requested_portal = 'school-admin' then
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
      insert into public.school_admin_requests(
        school_id, applicant_user_id, reason
      )
      values (requested_school_id, new.id, application_reason)
      on conflict (school_id, applicant_user_id) do nothing;
    end if;
  elsif requested_portal in ('student', 'teacher', 'parent', 'principal') then
    requested_school_slug :=
      lower(trim(new.raw_user_meta_data->>'requested_school_slug'));

    select id into requested_school_id
    from public.schools
    where (
        lower(slug) = requested_school_slug
        or lower(regexp_replace(
          name,
          '[^a-zA-Z0-9]+',
          '-',
          'g'
        )) = requested_school_slug
      )
      and status = 'active';

    if requested_school_id is null then
      raise exception 'An active school is required to request a portal account';
    end if;

    if requested_portal = 'parent'
      and nullif(trim(new.raw_user_meta_data->>'related_admission_number'), '') is null then
      raise exception 'Parents must provide their child admission number';
    end if;

    if requested_portal = 'parent' and request_phone is null then
      raise exception 'Parents must provide a phone number';
    end if;

    insert into public.school_account_requests(
      school_id,
      user_id,
      requested_role,
      applicant_name,
      applicant_email,
      applicant_phone,
      request_data
    )
    values (
      requested_school_id,
      new.id,
      requested_portal,
      coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), 'New user'),
      new.email,
      request_phone,
      jsonb_strip_nulls(jsonb_build_object(
        'date_of_birth', nullif(new.raw_user_meta_data->>'date_of_birth', ''),
        'related_admission_number', nullif(trim(new.raw_user_meta_data->>'related_admission_number'), ''),
        'relationship', nullif(trim(new.raw_user_meta_data->>'relationship'), '')
      ))
    );

    if requested_portal = 'teacher' then
      insert into public.teacher_applications(school_id, user_id, qualifications)
      values (
        requested_school_id,
        new.id,
        jsonb_build_object('application_reason', application_reason)
      )
      on conflict (school_id, user_id) do nothing;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.review_school_account_request(
  p_request_id uuid,
  p_decision text,
  p_notes text default null
)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_request public.school_account_requests%rowtype;
  v_reviewer uuid := auth.uid();
  v_school_slug text;
  v_year text := to_char(current_date, 'YYYY');
  v_counter bigint;
  v_name_parts text[];
  v_identifier text;
  v_student_id uuid;
  v_guardian_id uuid;
  v_student_id_for_parent uuid;
  v_birth_date date;
begin
  if v_reviewer is null then
    raise exception 'Authentication required';
  end if;

  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;

  select * into v_request
  from public.school_account_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Account request not found';
  end if;

  if not public.has_school_role(
    v_request.school_id,
    array['school_admin', 'principal']::public.platform_user_role[]
  ) then
    raise exception 'Only this school''s administrator or principal can review account requests';
  end if;

  if v_request.requested_role = 'principal'
    and not public.has_school_role(
      v_request.school_id,
      array['school_admin']::public.platform_user_role[]
    ) then
    raise exception 'Only the school administrator can approve a principal account';
  end if;

  if v_request.status = 'approved' then
    return v_request.generated_identifier;
  end if;

  if v_request.status <> 'pending' then
    raise exception 'This account request has already been rejected';
  end if;

  if p_decision = 'rejected' then
    update public.school_account_requests
    set status = 'rejected',
        decision_notes = nullif(trim(p_notes), ''),
        decided_by = v_reviewer,
        decided_at = now()
    where id = v_request.id;
    return null;
  end if;

  select slug into v_school_slug
  from public.schools
  where id = v_request.school_id and status = 'active';

  if v_school_slug is null then
    raise exception 'The school is not active';
  end if;

  v_school_slug := upper(trim(both '-' from regexp_replace(
    v_school_slug,
    '[^a-zA-Z0-9]+',
    '-',
    'g'
  )));

  if v_request.requested_role = 'student' then
    insert into public.school_counters(school_id, counter_name, counter_value)
    values (v_request.school_id, 'student:' || v_year, 1)
    on conflict (school_id, counter_name) do update
      set counter_value = public.school_counters.counter_value + 1,
          updated_at = now()
    returning counter_value into v_counter;

    v_identifier := v_school_slug || '/' || lpad(v_counter::text, 3, '0') || '/' || v_year;
    v_name_parts := regexp_split_to_array(trim(v_request.applicant_name), '\s+');
    begin
      v_birth_date := nullif(v_request.request_data->>'date_of_birth', '')::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      v_birth_date := null;
    end;

    insert into public.students(
      school_id,
      user_id,
      admission_number,
      first_name,
      last_name,
      date_of_birth,
      admission_date,
      created_by,
      status
    )
    values (
      v_request.school_id,
      v_request.user_id,
      v_identifier,
      v_name_parts[1],
      case when cardinality(v_name_parts) > 1
        then v_name_parts[cardinality(v_name_parts)]
        else v_name_parts[1]
      end,
      v_birth_date,
      current_date,
      v_reviewer,
      'active'
    )
    returning id into v_student_id;
  elsif v_request.requested_role in ('teacher', 'principal') then
    insert into public.school_counters(school_id, counter_name, counter_value)
    values (
      v_request.school_id,
      'staff:' || v_request.requested_role || ':' || v_year,
      1
    )
    on conflict (school_id, counter_name) do update
      set counter_value = public.school_counters.counter_value + 1,
          updated_at = now()
    returning counter_value into v_counter;

    v_identifier := v_school_slug || '/STAFF/' ||
      upper(v_request.requested_role) || '/' ||
      lpad(v_counter::text, 3, '0') || '/' || v_year;

    insert into public.school_memberships(
      school_id,
      user_id,
      role,
      status,
      approved_by,
      approved_at,
      member_number
    )
    values (
      v_request.school_id,
      v_request.user_id,
      v_request.requested_role::public.platform_user_role,
      'active',
      v_reviewer,
      now(),
      v_identifier
    )
    on conflict (school_id, user_id, role) do update
      set status = 'active',
          approved_by = excluded.approved_by,
          approved_at = excluded.approved_at,
          member_number = excluded.member_number;

    if v_request.requested_role = 'teacher' then
      update public.teacher_applications
      set status = 'approved',
          decision_notes = nullif(trim(p_notes), ''),
          decided_by = v_reviewer,
          decided_at = now()
      where school_id = v_request.school_id
        and user_id = v_request.user_id
        and status = 'pending';
    end if;
  elsif v_request.requested_role = 'parent' then
    select id into v_student_id_for_parent
    from public.students
    where school_id = v_request.school_id
      and upper(admission_number) = upper(trim(
        v_request.request_data->>'related_admission_number'
      ))
      and status = 'active';

    if v_student_id_for_parent is null then
      raise exception 'No active student with that admission number exists at this school';
    end if;

    insert into public.school_counters(school_id, counter_name, counter_value)
    values (v_request.school_id, 'parent:' || v_year, 1)
    on conflict (school_id, counter_name) do update
      set counter_value = public.school_counters.counter_value + 1,
          updated_at = now()
    returning counter_value into v_counter;

    v_identifier := v_school_slug || '/PARENT/' ||
      lpad(v_counter::text, 3, '0') || '/' || v_year;

    insert into public.guardians(
      school_id,
      user_id,
      full_name,
      phone,
      email,
      relationship,
      guardian_number
    )
    values (
      v_request.school_id,
      v_request.user_id,
      v_request.applicant_name,
      coalesce(v_request.applicant_phone, ''),
      v_request.applicant_email,
      coalesce(v_request.request_data->>'relationship', 'Parent/Guardian'),
      v_identifier
    )
    on conflict (school_id, user_id) do update
      set full_name = excluded.full_name,
          phone = excluded.phone,
          email = excluded.email,
          relationship = excluded.relationship,
          guardian_number = excluded.guardian_number
    returning id into v_guardian_id;

    insert into public.student_guardians(school_id, student_id, guardian_id, is_primary)
    values (v_request.school_id, v_student_id_for_parent, v_guardian_id, false)
    on conflict (student_id, guardian_id) do nothing;
  end if;

  update public.school_account_requests
  set status = 'approved',
      decision_notes = nullif(trim(p_notes), ''),
      decided_by = v_reviewer,
      decided_at = now(),
      generated_identifier = v_identifier
  where id = v_request.id;

  insert into public.audit_logs(
    school_id, actor_user_id, action, entity_type, entity_id, after_data
  )
  values (
    v_request.school_id,
    v_reviewer,
    'school_account_request_approved',
    'school_account_request',
    v_request.id,
    jsonb_build_object(
      'role', v_request.requested_role,
      'user_id', v_request.user_id,
      'identifier', v_identifier
    )
  );

  return v_identifier;
end;
$$;

revoke all on function public.review_school_account_request(uuid, text, text)
  from public, anon;
grant execute on function public.review_school_account_request(uuid, text, text)
  to authenticated;
