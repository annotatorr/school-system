-- SCHHOL SYSTEM: INITIAL DATABASE SCHEMA
-- Corrected ambiguous column references.

create extension if not exists pgcrypto;

create type public.platform_user_role as enum (
  'platform_admin','school_admin','principal','secretary',
  'teacher','student','parent'
);

create type public.school_status as enum (
  'pending','active','suspended','rejected','archived'
);

create type public.admission_status as enum (
  'draft','submitted','under_review','needs_correction','approved','rejected'
);

create type public.teacher_application_status as enum (
  'pending','approved','rejected'
);

create type public.payment_status as enum (
  'pending','processing','succeeded','failed','cancelled','reversed'
);

create type public.book_status as enum (
  'available','issued','lost','damaged','retired'
);

create type public.assignment_status as enum (
  'draft','in_review','approved','published','archived'
);

-- SCHOOLS AND USER PROFILES

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  registration_number text,
  school_type text,
  county text,
  sub_county text,
  address text,
  phone text,
  email text,
  logo_path text,
  status public.school_status not null default 'pending',
  subscription_status text not null default 'trial',
  suspended_at timestamptz,
  suspension_reason text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.school_memberships (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.platform_user_role not null,
  status text not null default 'active'
    check(status in ('pending','active','suspended','rejected')),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(school_id,user_id,role)
);

-- CLASSES AND STUDENTS

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  level text,
  academic_year int,
  stream text,
  class_teacher_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(school_id,name,academic_year,stream)
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid references public.profiles(id),
  class_id uuid references public.classes(id),
  admission_number text not null,
  first_name text not null,
  middle_name text,
  last_name text not null,
  date_of_birth date,
  gender text,
  photo_path text,
  admission_date date,
  status text not null default 'active'
    check(status in ('active','transferred','graduated','inactive')),
  previous_school text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(school_id,admission_number),
  unique(user_id)
);

create table public.guardians (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid references public.profiles(id),
  full_name text not null,
  phone text not null,
  email text,
  relationship text,
  created_at timestamptz not null default now(),
  unique(school_id,user_id)
);

create table public.student_guardians (
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  guardian_id uuid not null references public.guardians(id) on delete cascade,
  is_primary boolean not null default false,
  can_view_fees boolean not null default true,
  can_view_results boolean not null default true,
  created_at timestamptz not null default now(),
  primary key(student_id,guardian_id)
);

-- ADMISSIONS

create table public.admission_form_fields (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  field_key text not null,
  label text not null,
  field_type text not null
    check(field_type in ('text','textarea','date','phone','email','dropdown','checkbox','file')),
  required boolean not null default false,
  options jsonb not null default '[]'::jsonb,
  allowed_mime_types text[] not null default array[]::text[],
  max_file_mb int not null default 5
    check(max_file_mb between 1 and 25),
  sort_order int not null default 0,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(school_id,field_key)
);

create table public.admission_applications (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  application_reference text not null,
  guardian_user_id uuid references public.profiles(id),
  submitted_by_name text,
  submitted_by_phone text,
  student_first_name text not null,
  student_middle_name text,
  student_last_name text not null,
  date_of_birth date,
  requested_class_id uuid references public.classes(id),
  form_data jsonb not null default '{}'::jsonb,
  document_paths jsonb not null default '[]'::jsonb,
  status public.admission_status not null default 'submitted',
  review_notes text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  approved_student_id uuid references public.students(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(school_id,application_reference)
);

create table public.teacher_applications (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  qualifications jsonb not null default '{}'::jsonb,
  status public.teacher_application_status not null default 'pending',
  decision_notes text,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique(school_id,user_id)
);

-- SUBJECTS AND TEACHER ASSIGNMENTS

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  code text,
  curriculum text default 'CBC/CBE',
  created_at timestamptz not null default now(),
  unique(school_id,name)
);

create table public.teacher_assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  academic_year int not null,
  created_at timestamptz not null default now(),
  unique(teacher_id,class_id,subject_id,academic_year)
);

-- A teacher can be class teacher of only one class.
create unique index one_class_teacher_per_teacher
on public.classes(class_teacher_id)
where class_teacher_id is not null;

-- ATTENDANCE

create table public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null references public.classes(id),
  session_date date not null,
  session_label text default 'Daily',
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(class_id,session_date,session_label)
);

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  student_id uuid not null references public.students(id),
  status text not null
    check(status in ('present','absent','late','excused')),
  reason text,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique(session_id,student_id)
);

-- SCHOOL FEES AND PAYMENTS

create table public.fee_items (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  description text,
  category text not null default 'tuition',
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.fee_charges (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id),
  fee_item_id uuid references public.fee_items(id),
  term_name text not null,
  academic_year int not null,
  amount_kes numeric(12,2) not null check(amount_kes >= 0),
  due_date date,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id),
  guardian_user_id uuid references public.profiles(id),
  provider text not null check(provider in ('daraja','bank','manual')),
  amount_kes numeric(12,2) not null check(amount_kes > 0),
  maintenance_fee_kes numeric(12,2) not null default 7
    check(maintenance_fee_kes >= 0),
  status public.payment_status not null default 'pending',
  phone_number text,
  account_reference text not null,
  provider_request_id text,
  provider_checkout_id text,
  provider_receipt text,
  provider_transaction_id text,
  provider_payload jsonb not null default '{}'::jsonb,
  failure_reason text,
  initiated_by uuid references public.profiles(id),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider,provider_checkout_id)
);

create unique index payment_receipt_unique
on public.payment_intents(provider_receipt)
where provider_receipt is not null;

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  payment_intent_id uuid not null references public.payment_intents(id) on delete cascade,
  fee_charge_id uuid not null references public.fee_charges(id),
  amount_kes numeric(12,2) not null check(amount_kes > 0),
  created_at timestamptz not null default now()
);

create table public.platform_revenue_entries (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete set null,
  payment_intent_id uuid references public.payment_intents(id) on delete set null,
  entry_type text not null
    check(entry_type in ('maintenance_fee','subscription','adjustment')),
  amount_kes numeric(12,2) not null check(amount_kes >= 0),
  status text not null default 'pending',
  note text,
  created_at timestamptz not null default now()
);

-- ASSIGNMENTS AND STUDENT SUBMISSIONS

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id),
  class_id uuid not null references public.classes(id),
  subject_id uuid references public.subjects(id),
  title text not null,
  instructions text,
  content jsonb not null default '{}'::jsonb,
  due_at timestamptz,
  status public.assignment_status not null default 'draft',
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.students(id),
  submission_text text,
  file_paths jsonb not null default '[]'::jsonb,
  submitted_at timestamptz,
  score numeric(8,2),
  feedback text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(assignment_id,student_id)
);

-- TEXTBOOKS

create table public.textbooks (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  book_number text not null,
  title text not null,
  author text,
  subject_id uuid references public.subjects(id),
  class_level text,
  status public.book_status not null default 'available',
  condition_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(school_id,book_number)
);

create table public.textbook_issues (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  textbook_id uuid not null references public.textbooks(id),
  student_id uuid not null references public.students(id),
  issued_by uuid not null references public.profiles(id),
  issued_at timestamptz not null default now(),
  due_date date,
  returned_at timestamptz,
  returned_to uuid references public.profiles(id),
  status text not null default 'issued'
    check(status in ('issued','returned','lost','damaged')),
  notes text,
  created_at timestamptz not null default now()
);

create unique index one_open_issue_per_book
on public.textbook_issues(textbook_id)
where returned_at is null and status = 'issued';

-- MESSAGES, EVENTS, INVENTORY AND STAFF LEAVE

create table public.school_messages (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  title text,
  body text not null,
  audience jsonb not null default '{}'::jsonb,
  channel text not null default 'in_app',
  scheduled_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.school_events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  audience jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  category text,
  item_code text,
  quantity_on_hand numeric(12,2) not null default 0
    check(quantity_on_hand >= 0),
  reorder_level numeric(12,2) not null default 0,
  unit text default 'unit',
  location text,
  created_at timestamptz not null default now(),
  unique(school_id,item_code)
);

create table public.staff_leave_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  staff_user_id uuid not null references public.profiles(id),
  leave_type text not null,
  starts_on date not null,
  ends_on date not null,
  reason text,
  status text not null default 'pending'
    check(status in ('pending','approved','rejected','cancelled')),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check(ends_on >= starts_on)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete set null,
  actor_user_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  ip_hash text,
  created_at timestamptz not null default now()
);

-- INDEXES

create index memberships_user_idx
on public.school_memberships(user_id,status);

create index students_school_class_idx
on public.students(school_id,class_id);

create index payments_school_status_idx
on public.payment_intents(school_id,status,created_at desc);

create index attendance_school_date_idx
on public.attendance_sessions(school_id,session_date desc);

create index audit_school_date_idx
on public.audit_logs(school_id,created_at desc);

-- SECURITY HELPER FUNCTIONS

create or replace function public.has_school_role(
  p_school_id uuid,
  p_roles public.platform_user_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    exists (
      select 1
      from public.school_memberships m
      where m.school_id = p_school_id
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role = any(p_roles)
    )
    and exists (
      select 1
      from public.schools s
      where s.id = p_school_id
        and s.status = 'active'
    );
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.school_memberships m
    where m.user_id = auth.uid()
      and m.role = 'platform_admin'
      and m.status = 'active'
  );
$$;

create or replace function public.can_access_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.students s
    where s.id = p_student_id
      and (
        s.user_id = auth.uid()
        or exists (
          select 1
          from public.student_guardians sg
          join public.guardians g on g.id = sg.guardian_id
          where sg.student_id = s.id
            and g.user_id = auth.uid()
        )
        or public.has_school_role(
          s.school_id,
          array['school_admin','principal','secretary','teacher']
            ::public.platform_user_role[]
        )
      )
  );
$$;

-- CREATE A PROFILE WHEN A USER SIGNS UP

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id,full_name,email,phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name','New user'),
    new.email,
    new.raw_user_meta_data->>'phone'
  )
  on conflict(id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- ENABLE ROW LEVEL SECURITY

do $$
declare
  t text;
begin
  for t in
    select tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format(
      'alter table public.%I enable row level security',
      t
    );
  end loop;
end
$$;

-- SCHOOL ACCESS POLICIES

create policy schools_read_member
on public.schools
for select to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1
    from public.school_memberships m
    where m.school_id = schools.id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
);

create policy schools_platform_manage
on public.schools
for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

create policy profiles_read_self_or_same_school
on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or exists (
    select 1
    from public.school_memberships mine
    join public.school_memberships theirs
      on mine.school_id = theirs.school_id
    where mine.user_id = auth.uid()
      and mine.status = 'active'
      and theirs.user_id = profiles.id
      and theirs.status = 'active'
  )
);

create policy profiles_update_self
on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy memberships_read_scope
on public.school_memberships
for select to authenticated
using (
  user_id = auth.uid()
  or public.is_platform_admin()
  or public.has_school_role(
    school_id,
    array['school_admin','principal','secretary']::public.platform_user_role[]
  )
);

create policy memberships_manage_admin
on public.school_memberships
for all to authenticated
using (
  public.is_platform_admin()
  or public.has_school_role(
    school_id,
    array['school_admin','principal']::public.platform_user_role[]
  )
)
with check (
  public.is_platform_admin()
  or public.has_school_role(
    school_id,
    array['school_admin','principal']::public.platform_user_role[]
  )
);

-- BASELINE POLICIES FOR SCHOOL OPERATIONAL TABLES

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'classes','subjects','teacher_assignments',
      'attendance_sessions','attendance_records',
      'fee_items','fee_charges','payment_intents',
      'payment_allocations','assignments','assignment_submissions',
      'textbooks','textbook_issues','school_messages',
      'school_events','inventory_items','staff_leave_requests',
      'audit_logs','admission_form_fields','admission_applications',
      'teacher_applications','platform_revenue_entries'
    ])
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated
       using (
         public.is_platform_admin()
         or public.has_school_role(
           school_id,
           array[''school_admin'',''principal'',''secretary'']
             ::public.platform_user_role[]
         )
       )',
      t || '_admin_select',
      t
    );
  end loop;
end
$$;

-- STAFF WRITE POLICIES

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'classes','subjects','teacher_assignments',
      'attendance_sessions','attendance_records',
      'fee_items','fee_charges','assignments',
      'textbooks','textbook_issues','school_messages',
      'school_events','inventory_items','staff_leave_requests',
      'admission_form_fields','admission_applications',
      'teacher_applications'
    ])
  loop
    execute format(
      'create policy %I on public.%I for insert to authenticated
       with check (
         public.has_school_role(
           school_id,
           array[''school_admin'',''principal'',''secretary'']
             ::public.platform_user_role[]
         )
       )',
      t || '_staff_insert',
      t
    );

    execute format(
      'create policy %I on public.%I for update to authenticated
       using (
         public.has_school_role(
           school_id,
           array[''school_admin'',''principal'',''secretary'']
             ::public.platform_user_role[]
         )
       )
       with check (
         public.has_school_role(
           school_id,
           array[''school_admin'',''principal'',''secretary'']
             ::public.platform_user_role[]
         )
       )',
      t || '_staff_update',
      t
    );
  end loop;
end
$$;

-- STUDENT POLICIES

create policy students_read_authorized
on public.students
for select to authenticated
using (
  user_id = auth.uid()
  or public.is_platform_admin()
  or public.has_school_role(
    school_id,
    array['school_admin','principal','secretary']::public.platform_user_role[]
  )
  or exists (
    select 1
    from public.student_guardians sg
    join public.guardians g on g.id = sg.guardian_id
    where sg.student_id = students.id
      and g.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.teacher_assignments ta
    where ta.school_id = students.school_id
      and ta.teacher_id = auth.uid()
      and ta.class_id = students.class_id
  )
);

create policy students_staff_insert
on public.students
for insert to authenticated
with check (
  public.has_school_role(
    school_id,
    array['school_admin','principal','secretary']::public.platform_user_role[]
  )
);

create policy students_staff_update
on public.students
for update to authenticated
using (
  public.has_school_role(
    school_id,
    array['school_admin','principal','secretary']::public.platform_user_role[]
  )
  or exists (
    select 1
    from public.teacher_assignments ta
    where ta.school_id = students.school_id
      and ta.teacher_id = auth.uid()
      and ta.class_id = students.class_id
  )
)
with check (
  public.has_school_role(
    school_id,
    array['school_admin','principal','secretary']::public.platform_user_role[]
  )
  or exists (
    select 1
    from public.teacher_assignments ta
    where ta.school_id = students.school_id
      and ta.teacher_id = auth.uid()
      and ta.class_id = students.class_id
  )
);

-- GUARDIAN POLICIES

create policy guardians_read_related
on public.guardians
for select to authenticated
using (
  user_id = auth.uid()
  or public.is_platform_admin()
  or public.has_school_role(
    school_id,
    array['school_admin','principal','secretary']::public.platform_user_role[]
  )
  or exists (
    select 1
    from public.student_guardians sg
    join public.students s on s.id = sg.student_id
    where sg.guardian_id = guardians.id
      and exists (
        select 1
        from public.teacher_assignments ta
        where ta.class_id = s.class_id
          and ta.teacher_id = auth.uid()
      )
  )
);

create policy guardians_staff_manage
on public.guardians
for all to authenticated
using (
  public.has_school_role(
    school_id,
    array['school_admin','principal','secretary']::public.platform_user_role[]
  )
)
with check (
  public.has_school_role(
    school_id,
    array['school_admin','principal','secretary']::public.platform_user_role[]
  )
);

create policy student_guardians_read_related
on public.student_guardians
for select to authenticated
using (
  public.is_platform_admin()
  or public.has_school_role(
    school_id,
    array['school_admin','principal','secretary']::public.platform_user_role[]
  )
  or exists (
    select 1
    from public.students s
    where s.id = student_guardians.student_id
      and (
        s.user_id = auth.uid()
        or exists (
          select 1
          from public.guardians g
          where g.id = student_guardians.guardian_id
            and g.user_id = auth.uid()
        )
      )
  )
);

-- ATTENDANCE, FEES AND PAYMENTS

create policy attendance_student_read
on public.attendance_records
for select to authenticated
using (public.can_access_student(student_id));

create policy fees_student_read
on public.fee_charges
for select to authenticated
using (
  public.can_access_student(student_id)
  or public.has_school_role(
    school_id,
    array['school_admin','principal','secretary']::public.platform_user_role[]
  )
);

create policy payment_owner_read
on public.payment_intents
for select to authenticated
using (
  initiated_by = auth.uid()
  or public.can_access_student(student_id)
  or public.has_school_role(
    school_id,
    array['school_admin','principal','secretary']::public.platform_user_role[]
  )
);

-- ASSIGNMENTS AND TEXTBOOKS

create policy assignment_student_read
on public.assignments
for select to authenticated
using (
  (
    status = 'published'
    and public.can_access_student((
      select s.id
      from public.students s
      where s.class_id = assignments.class_id
        and s.user_id = auth.uid()
      limit 1
    ))
  )
  or teacher_id = auth.uid()
  or public.has_school_role(
    school_id,
    array['school_admin','principal','secretary']::public.platform_user_role[]
  )
);

create policy textbook_student_read
on public.textbook_issues
for select to authenticated
using (public.can_access_student(student_id));

-- AUDIT LOGS AND PLATFORM REVENUE

create policy audit_read_admin
on public.audit_logs
for select to authenticated
using (
  public.is_platform_admin()
  or public.has_school_role(
    school_id,
    array['school_admin','principal']::public.platform_user_role[]
  )
);

create policy platform_revenue_admin_read
on public.platform_revenue_entries
for select to authenticated
using (public.is_platform_admin());

create policy platform_revenue_admin_write
on public.platform_revenue_entries
for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

-- PRIVATE STORAGE BUCKET FOR ADMISSION DOCUMENTS

insert into storage.buckets(
  id,name,public,file_size_limit,allowed_mime_types
)
values (
  'school-private-documents',
  'school-private-documents',
  false,
  5242880,
  array['image/jpeg','image/png','application/pdf']
)
on conflict(id) do nothing;

create policy private_school_documents_read
on storage.objects
for select to authenticated
using (
  bucket_id = 'school-private-documents'
  and (
    public.is_platform_admin()
    or exists (
      select 1
      from public.school_memberships m
      where m.user_id = auth.uid()
        and m.status = 'active'
        and (storage.foldername(name))[1] = m.school_id::text
    )
  )
);

create policy private_school_documents_insert
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'school-private-documents'
  and exists (
    select 1
    from public.school_memberships m
    where m.user_id = auth.uid()
      and m.status = 'active'
      and m.school_id::text = (storage.foldername(name))[1]
      and m.role in ('school_admin','principal','secretary')
  )
);

-- IMPORTANT:
-- Review all role permissions before production.
-- Sensitive payments and approvals should be handled by Edge Functions.