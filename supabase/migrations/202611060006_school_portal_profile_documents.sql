create or replace function public.create_school_portal_account_request(
  p_user_id uuid,
  p_school_id uuid,
  p_role text,
  p_username text,
  p_password_salt text,
  p_password_hash text,
  p_full_name text,
  p_email text,
  p_phone text,
  p_date_of_birth text,
  p_related_admission_number text,
  p_relationship text,
  p_application_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
begin
  if p_role not in ('student', 'parent', 'teacher', 'principal') then
    raise exception 'Unsupported school account role';
  end if;
  if not exists (
    select 1 from public.schools
    where id = p_school_id and status = 'active'
  ) then
    raise exception 'The school is not active';
  end if;

  insert into public.profiles(id, full_name, email, phone)
  values (p_user_id, p_full_name, p_email, p_phone);

  insert into public.school_account_requests(
    school_id, user_id, requested_role, applicant_name, applicant_email,
    applicant_username, applicant_phone, request_data
  )
  values (
    p_school_id, p_user_id, p_role, p_full_name, p_email, p_username,
    p_phone,
    jsonb_strip_nulls(jsonb_build_object(
      'date_of_birth', nullif(p_date_of_birth, ''),
      'related_admission_number', nullif(trim(p_related_admission_number), ''),
      'relationship', nullif(trim(p_relationship), '')
    ))
  )
  returning id into v_request_id;

  insert into public.portal_login_credentials(
    user_id, school_id, request_id, requested_role, username,
    password_salt, password_hash, status
  )
  values (
    p_user_id, p_school_id, v_request_id, p_role, p_username,
    p_password_salt, p_password_hash, 'pending'
  );

  if p_role = 'teacher' then
    insert into public.teacher_applications(school_id, user_id, qualifications)
    values (
      p_school_id,
      p_user_id,
      jsonb_build_object('application_reason', nullif(trim(p_application_reason), ''))
    );
  end if;

  return v_request_id;
end;
$$;

revoke all on function public.create_school_portal_account_request(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_school_portal_account_request(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text, text
) to service_role;

create table if not exists public.portal_account_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  role text not null
    check (role in ('student', 'parent', 'teacher', 'principal')),
  phone text,
  date_of_birth date,
  guardian_name text,
  guardian_phone text,
  emergency_contact_name text not null,
  emergency_contact_phone text not null,
  national_id text,
  is_complete boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists portal_account_profiles_school_idx
  on public.portal_account_profiles(school_id, role);

alter table public.portal_account_profiles enable row level security;
revoke all on public.portal_account_profiles from public, anon;
grant select, insert, update on public.portal_account_profiles to authenticated;

drop policy if exists portal_account_profiles_owner_read
  on public.portal_account_profiles;
create policy portal_account_profiles_owner_read
  on public.portal_account_profiles for select to authenticated
  using (user_id = auth.uid());

drop policy if exists portal_account_profiles_owner_insert
  on public.portal_account_profiles;
create policy portal_account_profiles_owner_insert
  on public.portal_account_profiles for insert to authenticated
  with check (
    user_id = auth.uid()
    and school_id = public.uuid_or_null(auth.jwt()->>'school_id')
    and role = auth.jwt()->>'school_role'
  );

drop policy if exists portal_account_profiles_owner_update
  on public.portal_account_profiles;
create policy portal_account_profiles_owner_update
  on public.portal_account_profiles for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and school_id = public.uuid_or_null(auth.jwt()->>'school_id')
    and role = auth.jwt()->>'school_role'
  );

drop policy if exists portal_account_profiles_school_read
  on public.portal_account_profiles;
create policy portal_account_profiles_school_read
  on public.portal_account_profiles for select to authenticated
  using (
    public.has_school_role(
      school_id,
      array['school_admin', 'principal']::public.platform_user_role[]
    )
  );

create table if not exists public.portal_account_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  role text not null
    check (role in ('student', 'parent', 'teacher', 'principal')),
  document_type text not null
    check (document_type in ('birth_certificate', 'invitation_letter', 'supporting_document')),
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null
    check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  file_size integer not null check (file_size > 0 and file_size <= 5242880),
  created_at timestamptz not null default now(),
  unique(user_id, document_type)
);

create index if not exists portal_account_documents_school_idx
  on public.portal_account_documents(school_id, user_id);

alter table public.portal_account_documents enable row level security;
revoke all on public.portal_account_documents from public, anon;
grant select, insert, update on public.portal_account_documents to authenticated;

drop policy if exists portal_account_documents_owner_read
  on public.portal_account_documents;
create policy portal_account_documents_owner_read
  on public.portal_account_documents for select to authenticated
  using (user_id = auth.uid());

drop policy if exists portal_account_documents_owner_insert
  on public.portal_account_documents;
create policy portal_account_documents_owner_insert
  on public.portal_account_documents for insert to authenticated
  with check (
    user_id = auth.uid()
    and school_id = public.uuid_or_null(auth.jwt()->>'school_id')
    and role = auth.jwt()->>'school_role'
  );

drop policy if exists portal_account_documents_owner_update
  on public.portal_account_documents;
create policy portal_account_documents_owner_update
  on public.portal_account_documents for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and school_id = public.uuid_or_null(auth.jwt()->>'school_id')
    and role = auth.jwt()->>'school_role'
  );

drop policy if exists portal_account_documents_school_read
  on public.portal_account_documents;
create policy portal_account_documents_school_read
  on public.portal_account_documents for select to authenticated
  using (
    public.has_school_role(
      school_id,
      array['school_admin', 'principal']::public.platform_user_role[]
    )
  );

drop policy if exists portal_account_documents_storage_insert
  on storage.objects;
create policy portal_account_documents_storage_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'school-private-documents'
    and (storage.foldername(name))[1] = 'portal-documents'
    and (storage.foldername(name))[3] = auth.uid()::text
    and (storage.foldername(name))[2] = auth.jwt()->>'school_id'
  );

drop policy if exists portal_account_documents_storage_read
  on storage.objects;
create policy portal_account_documents_storage_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'school-private-documents'
    and (storage.foldername(name))[1] = 'portal-documents'
    and (
      (storage.foldername(name))[3] = auth.uid()::text
      or public.has_school_role(
        public.uuid_or_null((storage.foldername(name))[2]),
        array['school_admin', 'principal']::public.platform_user_role[]
      )
    )
  );

drop policy if exists portal_account_documents_storage_update
  on storage.objects;
create policy portal_account_documents_storage_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'school-private-documents'
    and (storage.foldername(name))[1] = 'portal-documents'
    and (storage.foldername(name))[3] = auth.uid()::text
    and (storage.foldername(name))[2] = auth.jwt()->>'school_id'
  )
  with check (
    bucket_id = 'school-private-documents'
    and (storage.foldername(name))[1] = 'portal-documents'
    and (storage.foldername(name))[3] = auth.uid()::text
    and (storage.foldername(name))[2] = auth.jwt()->>'school_id'
  );

drop policy if exists portal_account_documents_storage_delete
  on storage.objects;
create policy portal_account_documents_storage_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'school-private-documents'
    and (storage.foldername(name))[1] = 'portal-documents'
    and (storage.foldername(name))[3] = auth.uid()::text
    and (storage.foldername(name))[2] = auth.jwt()->>'school_id'
  );
