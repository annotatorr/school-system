-- SCHHOL SYSTEM: COMPLETE OPERATIONAL SCHEMA
-- Adds the domains required by the full specification, with school-scoped RLS,
-- secure helper functions and transactional RPCs.
-- Apply after 202610260003_teacher_signup_requests.sql.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- HELPERS
-- ---------------------------------------------------------------------------

create or replace function public.can_manage_school(p_school_id uuid)
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select public.has_school_role(
    p_school_id,
    array['school_admin','principal','secretary']::public.platform_user_role[]
  );
$$;

create or replace function public.can_lead_school(p_school_id uuid)
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select public.has_school_role(
    p_school_id,
    array['school_admin','principal']::public.platform_user_role[]
  );
$$;

-- Safe cast used by storage policies so unrelated objects whose path does not
-- begin with a UUID never raise a runtime cast error.
create or replace function public.uuid_or_null(p_value text)
returns uuid
language plpgsql immutable
as $$
begin
  if p_value is null or p_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return p_value::uuid;
exception when others then
  return null;
end;
$$;

-- Any active membership (including teachers), an active student account, or a
-- verified guardian of an active student in the school.
create or replace function public.is_school_participant(p_school_id uuid)
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select
    exists (
      select 1 from public.school_memberships m
      where m.school_id = p_school_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
    or exists (
      select 1 from public.students s
      where s.school_id = p_school_id
        and s.user_id = auth.uid()
        and s.status = 'active'
    )
    or exists (
      select 1
      from public.guardians g
      join public.student_guardians sg on sg.guardian_id = g.id
      join public.students st on st.id = sg.student_id
      where g.school_id = p_school_id
        and g.user_id = auth.uid()
        and st.school_id = p_school_id
        and st.status = 'active'
    );
$$;

-- ---------------------------------------------------------------------------
-- SCHOOL COLUMNS (identity, configuration, subscription plan)
-- ---------------------------------------------------------------------------

alter table public.schools add column if not exists code text;
alter table public.schools add column if not exists category text;
alter table public.schools add column if not exists ownership_type text;
alter table public.schools add column if not exists country text default 'Kenya';
alter table public.schools add column if not exists town text;
alter table public.schools add column if not exists website text;
alter table public.schools add column if not exists contact_person text;
alter table public.schools add column if not exists academic_system text default 'CBC';
alter table public.schools add column if not exists grading_system jsonb not null default '{}'::jsonb;
alter table public.schools add column if not exists timetable_settings jsonb not null default '{}'::jsonb;
alter table public.schools add column if not exists fee_policy jsonb not null default '{}'::jsonb;
alter table public.schools add column if not exists notification_policy jsonb not null default '{}'::jsonb;
alter table public.schools add column if not exists module_settings jsonb not null default '{}'::jsonb;

create unique index if not exists schools_code_unique
on public.schools (upper(code))
where code is not null;

alter table public.school_memberships add column if not exists department text;
alter table public.school_memberships add column if not exists job_title text;
alter table public.school_memberships add column if not exists employment_date date;

alter table public.students add column if not exists address text;
alter table public.students add column if not exists medical_notes text;

alter table public.guardians add column if not exists address text;
alter table public.guardians add column if not exists emergency_contact boolean not null default false;

-- ---------------------------------------------------------------------------
-- ACADEMIC YEARS, TERMS AND CONFIGURATION
-- ---------------------------------------------------------------------------

create table if not exists public.academic_years (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  starts_on date,
  ends_on date,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  unique (school_id, name)
);

create table if not exists public.terms (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  name text not null,
  starts_on date,
  ends_on date,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  unique (academic_year_id, name)
);

create table if not exists public.grading_scales (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  boundaries jsonb not null default '[]'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (school_id, name)
);

create table if not exists public.exam_types (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  weight numeric(5,2) not null default 100 check (weight > 0 and weight <= 100),
  created_at timestamptz not null default now(),
  unique (school_id, name)
);

-- ---------------------------------------------------------------------------
-- TIMETABLE, LESSON PLANS, LEARNING MATERIALS
-- ---------------------------------------------------------------------------

create table if not exists public.timetable_slots (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  academic_year_id uuid references public.academic_years(id) on delete set null,
  term_id uuid references public.terms(id) on delete set null,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  teacher_id uuid references public.profiles(id) on delete set null,
  day_of_week int not null check (day_of_week between 1 and 7),
  start_time time not null,
  end_time time not null,
  room text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);

create index if not exists timetable_school_day_idx
on public.timetable_slots (school_id, day_of_week, start_time);

create table if not exists public.lesson_plans (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid references public.classes(id) on delete set null,
  subject_id uuid references public.subjects(id) on delete set null,
  term_id uuid references public.terms(id) on delete set null,
  topic text not null,
  subtopic text,
  objectives text,
  outcomes text,
  resources text,
  methods text,
  activities text,
  assessment_methods text,
  duration_minutes int default 40 check (duration_minutes > 0),
  lesson_date date,
  reflection text,
  status text not null default 'draft' check (status in ('draft','shared','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.learning_materials (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  teacher_id uuid references public.profiles(id) on delete set null,
  class_id uuid references public.classes(id) on delete set null,
  subject_id uuid references public.subjects(id) on delete set null,
  term_id uuid references public.terms(id) on delete set null,
  title text not null,
  description text,
  file_path text,
  external_url text,
  resource_type text not null default 'notes'
    check (resource_type in ('notes','document','presentation','video','link','other')),
  published boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- ASSESSMENTS, RESULTS AND REPORT CARDS
-- ---------------------------------------------------------------------------

create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  teacher_id uuid references public.profiles(id) on delete set null,
  academic_year_id uuid references public.academic_years(id) on delete set null,
  term_id uuid references public.terms(id) on delete set null,
  exam_type_id uuid references public.exam_types(id) on delete set null,
  title text not null,
  assessment_type text not null default 'cat'
    check (assessment_type in ('cat','exam','quiz','project','assignment','practical')),
  instructions text,
  max_marks numeric(8,2) not null default 100 check (max_marks > 0),
  weight numeric(5,2) default 100 check (weight > 0 and weight <= 100),
  assessment_date date,
  status text not null default 'draft'
    check (status in ('draft','submitted','reviewed','published','archived')),
  published_at timestamptz,
  published_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assessment_results (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  marks numeric(8,2) not null check (marks >= 0),
  grade text,
  remarks text,
  entered_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id, student_id)
);

create table if not exists public.report_cards (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  term_id uuid references public.terms(id) on delete set null,
  academic_year_id uuid references public.academic_years(id) on delete set null,
  average_marks numeric(8,2),
  grade text,
  class_position int,
  teacher_comment text,
  principal_comment text,
  status text not null default 'draft' check (status in ('draft','published')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (student_id, term_id)
);

-- ---------------------------------------------------------------------------
-- FEES
-- ---------------------------------------------------------------------------

create table if not exists public.fee_discounts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  name text not null,
  discount_type text not null default 'amount' check (discount_type in ('amount','percent')),
  value numeric(12,2) not null check (value > 0),
  term_name text,
  academic_year int,
  approved_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  payment_intent_id uuid references public.payment_intents(id) on delete set null,
  student_id uuid not null references public.students(id) on delete cascade,
  receipt_number text not null,
  amount_kes numeric(12,2) not null check (amount_kes > 0),
  issued_by uuid references public.profiles(id),
  issued_at timestamptz not null default now(),
  notes text,
  unique (school_id, receipt_number)
);

create table if not exists public.payment_verification_queue (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  provider text not null check (provider in ('daraja','bank','manual')),
  reference text not null,
  amount_kes numeric(12,2) not null check (amount_kes > 0),
  paid_on date,
  notes text,
  status text not null default 'awaiting_verification'
    check (status in ('awaiting_verification','verified','rejected')),
  submitted_by uuid references public.profiles(id),
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- LIBRARY (catalogue = textbooks.book_number; issues = textbook_issues)
-- ---------------------------------------------------------------------------

alter table public.textbooks add column if not exists publisher text;
alter table public.textbooks add column if not exists isbn text;
alter table public.textbooks add column if not exists category text;

-- ---------------------------------------------------------------------------
-- TRANSPORT
-- ---------------------------------------------------------------------------

create table if not exists public.transport_routes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  description text,
  fee_kes numeric(12,2) not null default 0 check (fee_kes >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.transport_vehicles (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  registration_number text not null,
  capacity int check (capacity is null or capacity > 0),
  driver_name text,
  driver_phone text,
  conductor_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (school_id, registration_number)
);

create table if not exists public.student_transport (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  route_id uuid not null references public.transport_routes(id) on delete cascade,
  vehicle_id uuid references public.transport_vehicles(id) on delete set null,
  stop_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (student_id, route_id)
);

-- ---------------------------------------------------------------------------
-- MEALS
-- ---------------------------------------------------------------------------

create table if not exists public.meal_programmes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  term_id uuid references public.terms(id) on delete set null,
  fee_kes numeric(12,2) not null default 0 check (fee_kes >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.meal_menus (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  programme_id uuid not null references public.meal_programmes(id) on delete cascade,
  day_of_week int not null check (day_of_week between 1 and 7),
  meal_type text not null default 'lunch',
  items text not null,
  created_at timestamptz not null default now(),
  unique (programme_id, day_of_week, meal_type)
);

create table if not exists public.meal_participation (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  programme_id uuid not null references public.meal_programmes(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (programme_id, student_id)
);

-- ---------------------------------------------------------------------------
-- DISCIPLINE, WELFARE, SUBSTITUTIONS
-- ---------------------------------------------------------------------------

create table if not exists public.discipline_incidents (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  category text not null,
  severity text not null default 'minor' check (severity in ('minor','moderate','major','critical')),
  description text not null,
  action_taken text,
  status text not null default 'open' check (status in ('open','under_review','resolved','closed')),
  reported_by uuid references public.profiles(id),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.welfare_notes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  note text not null,
  confidentiality text not null default 'staff'
    check (confidentiality in ('staff','leadership','restricted')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.staff_substitutions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  absent_staff_id uuid not null references public.profiles(id) on delete cascade,
  substitute_staff_id uuid references public.profiles(id) on delete set null,
  starts_on date not null,
  ends_on date not null,
  reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

-- ---------------------------------------------------------------------------
-- DOCUMENTS, NOTIFICATIONS, SUPPORT
-- ---------------------------------------------------------------------------

create table if not exists public.school_documents (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  document_type text not null default 'general',
  title text not null,
  file_path text,
  content text,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('draft','active','archived')),
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text,
  category text not null default 'general',
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
on public.notifications (user_id, created_at desc);

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete set null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  subject text not null,
  message text not null,
  status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  response text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- PLATFORM SUBSCRIPTION PLANS AND INVOICES
-- ---------------------------------------------------------------------------

create table if not exists public.platform_subscription_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  price_kes numeric(12,2) not null default 0 check (price_kes >= 0),
  billing_period text not null default 'annual'
    check (billing_period in ('monthly','termly','annual')),
  features jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  plan_id uuid references public.platform_subscription_plans(id) on delete set null,
  invoice_number text not null unique,
  amount_kes numeric(12,2) not null check (amount_kes >= 0),
  status text not null default 'unpaid'
    check (status in ('draft','unpaid','paid','failed','cancelled','refunded')),
  issued_at date not null default current_date,
  due_at date,
  paid_at timestamptz,
  reference text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.platform_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  description text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (key, value, description)
values
  ('support_email', '"support@schhol.app"'::jsonb, 'Public platform support email'),
  ('maintenance_mode', 'false'::jsonb, 'Pause new school provisioning'),
  ('default_subscription_plan', '"Trial"'::jsonb, 'Plan assigned to newly registered schools')
on conflict (key) do nothing;

insert into public.platform_subscription_plans (name, price_kes, billing_period, features)
values
  ('Trial', 0, 'annual', '{"max_students": 50, "trial": true}'::jsonb),
  ('Standard', 60000, 'annual', '{"max_students": 500}'::jsonb),
  ('Premium', 120000, 'annual', '{"max_students": 5000}'::jsonb)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.academic_years enable row level security;
alter table public.terms enable row level security;
alter table public.grading_scales enable row level security;
alter table public.exam_types enable row level security;
alter table public.timetable_slots enable row level security;
alter table public.lesson_plans enable row level security;
alter table public.learning_materials enable row level security;
alter table public.assessments enable row level security;
alter table public.assessment_results enable row level security;
alter table public.report_cards enable row level security;
alter table public.fee_discounts enable row level security;
alter table public.receipts enable row level security;
alter table public.payment_verification_queue enable row level security;
alter table public.transport_routes enable row level security;
alter table public.transport_vehicles enable row level security;
alter table public.student_transport enable row level security;
alter table public.meal_programmes enable row level security;
alter table public.meal_menus enable row level security;
alter table public.meal_participation enable row level security;
alter table public.discipline_incidents enable row level security;
alter table public.welfare_notes enable row level security;
alter table public.staff_substitutions enable row level security;
alter table public.school_documents enable row level security;
alter table public.notifications enable row level security;
alter table public.support_tickets enable row level security;
alter table public.platform_subscription_plans enable row level security;
alter table public.platform_subscription_invoices enable row level security;
alter table public.platform_settings enable row level security;

drop policy if exists platform_settings_admin on public.platform_settings;
create policy platform_settings_admin on public.platform_settings for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

-- Academic configuration: staff manage, participants read.
drop policy if exists academic_years_read on public.academic_years;
create policy academic_years_read on public.academic_years for select to authenticated
using (public.is_platform_admin() or public.is_school_participant(school_id));
drop policy if exists academic_years_manage on public.academic_years;
create policy academic_years_manage on public.academic_years for all to authenticated
using (public.is_platform_admin() or public.can_manage_school(school_id))
with check (public.is_platform_admin() or public.can_manage_school(school_id));

drop policy if exists terms_read on public.terms;
create policy terms_read on public.terms for select to authenticated
using (public.is_platform_admin() or public.is_school_participant(school_id));
drop policy if exists terms_manage on public.terms;
create policy terms_manage on public.terms for all to authenticated
using (public.is_platform_admin() or public.can_manage_school(school_id))
with check (public.is_platform_admin() or public.can_manage_school(school_id));

drop policy if exists grading_scales_read on public.grading_scales;
create policy grading_scales_read on public.grading_scales for select to authenticated
using (public.is_platform_admin() or public.is_school_participant(school_id));
drop policy if exists grading_scales_manage on public.grading_scales;
create policy grading_scales_manage on public.grading_scales for all to authenticated
using (public.is_platform_admin() or public.can_lead_school(school_id))
with check (public.is_platform_admin() or public.can_lead_school(school_id));

drop policy if exists exam_types_read on public.exam_types;
create policy exam_types_read on public.exam_types for select to authenticated
using (public.is_platform_admin() or public.is_school_participant(school_id));
drop policy if exists exam_types_manage on public.exam_types;
create policy exam_types_manage on public.exam_types for all to authenticated
using (public.is_platform_admin() or public.can_manage_school(school_id))
with check (public.is_platform_admin() or public.can_manage_school(school_id));

-- Timetable: every participant may read; managers create; teachers read own.
drop policy if exists timetable_read on public.timetable_slots;
create policy timetable_read on public.timetable_slots for select to authenticated
using (public.is_platform_admin() or public.is_school_participant(school_id));
drop policy if exists timetable_manage on public.timetable_slots;
create policy timetable_manage on public.timetable_slots for all to authenticated
using (public.is_platform_admin() or public.can_manage_school(school_id))
with check (public.is_platform_admin() or public.can_manage_school(school_id));

-- Lesson plans and materials.
drop policy if exists lesson_plans_read on public.lesson_plans;
create policy lesson_plans_read on public.lesson_plans for select to authenticated
using (
  public.is_platform_admin()
  or public.can_manage_school(school_id)
  or teacher_id = auth.uid()
);
drop policy if exists lesson_plans_teacher_manage on public.lesson_plans;
create policy lesson_plans_teacher_manage on public.lesson_plans for all to authenticated
using (
  public.is_platform_admin()
  or public.can_manage_school(school_id)
  or (teacher_id = auth.uid() and public.has_school_role(school_id, array['teacher']::public.platform_user_role[]))
)
with check (
  public.is_platform_admin()
  or public.can_manage_school(school_id)
  or (teacher_id = auth.uid() and public.has_school_role(school_id, array['teacher']::public.platform_user_role[]))
);

drop policy if exists learning_materials_read on public.learning_materials;
create policy learning_materials_read on public.learning_materials for select to authenticated
using (
  public.is_platform_admin()
  or public.can_manage_school(school_id)
  or teacher_id = auth.uid()
  or (
    published
    and public.is_school_participant(school_id)
    and (
      class_id is null
      or exists (
        select 1 from public.students st
        where st.school_id = learning_materials.school_id
          and st.class_id = learning_materials.class_id
          and st.user_id = auth.uid()
          and st.status = 'active'
      )
      or exists (
        select 1
        from public.guardians g
        join public.student_guardians sg on sg.guardian_id = g.id
        join public.students st on st.id = sg.student_id
        where g.user_id = auth.uid()
          and st.class_id = learning_materials.class_id
          and st.school_id = learning_materials.school_id
          and st.status = 'active'
      )
    )
  )
);
drop policy if exists learning_materials_teacher_manage on public.learning_materials;
create policy learning_materials_teacher_manage on public.learning_materials for all to authenticated
using (
  public.is_platform_admin()
  or public.can_manage_school(school_id)
  or (teacher_id = auth.uid() and public.has_school_role(school_id, array['teacher']::public.platform_user_role[]))
)
with check (
  public.is_platform_admin()
  or public.can_manage_school(school_id)
  or (teacher_id = auth.uid() and public.has_school_role(school_id, array['teacher']::public.platform_user_role[]))
);

-- Assessments and results.
drop policy if exists assessments_read on public.assessments;
create policy assessments_read on public.assessments for select to authenticated
using (
  public.is_platform_admin()
  or public.can_manage_school(school_id)
  or teacher_id = auth.uid()
  or (
    status = 'published'
    and (
      exists (
        select 1 from public.students st
        where st.school_id = assessments.school_id
          and st.class_id = assessments.class_id
          and st.user_id = auth.uid()
          and st.status = 'active'
      )
      or exists (
        select 1
        from public.guardians g
        join public.student_guardians sg on sg.guardian_id = g.id
        join public.students st on st.id = sg.student_id
        where g.user_id = auth.uid()
          and st.class_id = assessments.class_id
          and st.school_id = assessments.school_id
          and st.status = 'active'
      )
    )
  )
);
drop policy if exists assessments_teacher_insert on public.assessments;
create policy assessments_teacher_insert on public.assessments for insert to authenticated
with check (
  public.can_manage_school(school_id)
  or (
    teacher_id = auth.uid()
    and status = 'draft'
    and public.has_school_role(school_id, array['teacher']::public.platform_user_role[])
    and exists (
      select 1 from public.teacher_assignments ta
      where ta.school_id = assessments.school_id
        and ta.teacher_id = auth.uid()
        and ta.class_id = assessments.class_id
        and (assessments.subject_id is null or ta.subject_id = assessments.subject_id)
    )
  )
);
drop policy if exists assessments_teacher_update on public.assessments;
create policy assessments_teacher_update on public.assessments for update to authenticated
using (
  public.can_manage_school(school_id)
  or (teacher_id = auth.uid() and status in ('draft','submitted'))
)
with check (
  public.can_manage_school(school_id)
  or (teacher_id = auth.uid() and status in ('draft','submitted'))
);

drop policy if exists assessment_results_read on public.assessment_results;
create policy assessment_results_read on public.assessment_results for select to authenticated
using (
  public.is_platform_admin()
  or public.can_manage_school(school_id)
  or public.can_access_student(student_id)
  or exists (
    select 1 from public.assessments a
    where a.id = assessment_results.assessment_id
      and a.teacher_id = auth.uid()
  )
);
drop policy if exists assessment_results_teacher_manage on public.assessment_results;
create policy assessment_results_teacher_manage on public.assessment_results for all to authenticated
using (
  public.can_manage_school(school_id)
  or exists (
    select 1 from public.assessments a
    where a.id = assessment_results.assessment_id
      and a.teacher_id = auth.uid()
      and a.status in ('draft','submitted','reviewed')
  )
)
with check (
  public.can_manage_school(school_id)
  or exists (
    select 1 from public.assessments a
    where a.id = assessment_results.assessment_id
      and a.teacher_id = auth.uid()
      and a.status in ('draft','submitted','reviewed')
  )
);

drop policy if exists report_cards_read on public.report_cards;
create policy report_cards_read on public.report_cards for select to authenticated
using (
  public.is_platform_admin()
  or public.can_manage_school(school_id)
  or (status = 'published' and public.can_access_student(student_id))
);
drop policy if exists report_cards_manage on public.report_cards;
create policy report_cards_manage on public.report_cards for all to authenticated
using (public.is_platform_admin() or public.can_lead_school(school_id))
with check (public.is_platform_admin() or public.can_lead_school(school_id));

-- Fees.
drop policy if exists fee_discounts_read on public.fee_discounts;
create policy fee_discounts_read on public.fee_discounts for select to authenticated
using (
  public.is_platform_admin()
  or public.can_manage_school(school_id)
  or public.can_access_student(student_id)
);
drop policy if exists fee_discounts_manage on public.fee_discounts;
create policy fee_discounts_manage on public.fee_discounts for all to authenticated
using (public.is_platform_admin() or public.can_lead_school(school_id))
with check (public.is_platform_admin() or public.can_lead_school(school_id));

drop policy if exists receipts_read on public.receipts;
create policy receipts_read on public.receipts for select to authenticated
using (
  public.is_platform_admin()
  or public.can_manage_school(school_id)
  or public.can_access_student(student_id)
);
drop policy if exists receipts_manage on public.receipts;
create policy receipts_manage on public.receipts for all to authenticated
using (public.is_platform_admin() or public.can_manage_school(school_id))
with check (public.is_platform_admin() or public.can_manage_school(school_id));

drop policy if exists payment_verification_read on public.payment_verification_queue;
create policy payment_verification_read on public.payment_verification_queue for select to authenticated
using (
  public.is_platform_admin()
  or public.can_manage_school(school_id)
  or submitted_by = auth.uid()
);
drop policy if exists payment_verification_manage on public.payment_verification_queue;
create policy payment_verification_manage on public.payment_verification_queue for all to authenticated
using (public.is_platform_admin() or public.can_manage_school(school_id))
with check (public.is_platform_admin() or public.can_manage_school(school_id));

-- Guardians/students may submit bank or manual payment references for verification.
drop policy if exists payment_verification_family_insert on public.payment_verification_queue;
create policy payment_verification_family_insert on public.payment_verification_queue for insert to authenticated
with check (
  submitted_by = auth.uid()
  and status = 'awaiting_verification'
  and public.can_access_student(student_id)
);

-- Transport.
drop policy if exists transport_routes_read on public.transport_routes;
create policy transport_routes_read on public.transport_routes for select to authenticated
using (public.is_platform_admin() or public.is_school_participant(school_id));
drop policy if exists transport_routes_manage on public.transport_routes;
create policy transport_routes_manage on public.transport_routes for all to authenticated
using (public.is_platform_admin() or public.can_manage_school(school_id))
with check (public.is_platform_admin() or public.can_manage_school(school_id));

drop policy if exists transport_vehicles_read on public.transport_vehicles;
create policy transport_vehicles_read on public.transport_vehicles for select to authenticated
using (public.is_platform_admin() or public.is_school_participant(school_id));
drop policy if exists transport_vehicles_manage on public.transport_vehicles;
create policy transport_vehicles_manage on public.transport_vehicles for all to authenticated
using (public.is_platform_admin() or public.can_manage_school(school_id))
with check (public.is_platform_admin() or public.can_manage_school(school_id));

drop policy if exists student_transport_read on public.student_transport;
create policy student_transport_read on public.student_transport for select to authenticated
using (
  public.is_platform_admin()
  or public.can_manage_school(school_id)
  or public.can_access_student(student_id)
);
drop policy if exists student_transport_manage on public.student_transport;
create policy student_transport_manage on public.student_transport for all to authenticated
using (public.is_platform_admin() or public.can_manage_school(school_id))
with check (public.is_platform_admin() or public.can_manage_school(school_id));

-- Meals.
drop policy if exists meal_programmes_read on public.meal_programmes;
create policy meal_programmes_read on public.meal_programmes for select to authenticated
using (public.is_platform_admin() or public.is_school_participant(school_id));
drop policy if exists meal_programmes_manage on public.meal_programmes;
create policy meal_programmes_manage on public.meal_programmes for all to authenticated
using (public.is_platform_admin() or public.can_manage_school(school_id))
with check (public.is_platform_admin() or public.can_manage_school(school_id));

drop policy if exists meal_menus_read on public.meal_menus;
create policy meal_menus_read on public.meal_menus for select to authenticated
using (public.is_platform_admin() or public.is_school_participant(school_id));
drop policy if exists meal_menus_manage on public.meal_menus;
create policy meal_menus_manage on public.meal_menus for all to authenticated
using (public.is_platform_admin() or public.can_manage_school(school_id))
with check (public.is_platform_admin() or public.can_manage_school(school_id));

drop policy if exists meal_participation_read on public.meal_participation;
create policy meal_participation_read on public.meal_participation for select to authenticated
using (public.is_platform_admin() or public.can_manage_school(school_id) or public.can_access_student(student_id));
drop policy if exists meal_participation_manage on public.meal_participation;
create policy meal_participation_manage on public.meal_participation for all to authenticated
using (public.is_platform_admin() or public.can_manage_school(school_id))
with check (public.is_platform_admin() or public.can_manage_school(school_id));

-- Discipline and welfare.
drop policy if exists discipline_read on public.discipline_incidents;
create policy discipline_read on public.discipline_incidents for select to authenticated
using (public.is_platform_admin() or public.can_lead_school(school_id) or public.can_access_student(student_id));
drop policy if exists discipline_manage on public.discipline_incidents;
create policy discipline_manage on public.discipline_incidents for all to authenticated
using (public.is_platform_admin() or public.can_manage_school(school_id))
with check (public.is_platform_admin() or public.can_manage_school(school_id));

drop policy if exists welfare_read on public.welfare_notes;
create policy welfare_read on public.welfare_notes for select to authenticated
using (
  public.is_platform_admin()
  or public.can_lead_school(school_id)
  or (confidentiality <> 'restricted' and public.can_manage_school(school_id))
);
drop policy if exists welfare_manage on public.welfare_notes;
create policy welfare_manage on public.welfare_notes for all to authenticated
using (public.is_platform_admin() or public.can_lead_school(school_id))
with check (public.is_platform_admin() or public.can_lead_school(school_id));

-- Substitutions.
drop policy if exists substitutions_read on public.staff_substitutions;
create policy substitutions_read on public.staff_substitutions for select to authenticated
using (
  public.is_platform_admin()
  or public.can_manage_school(school_id)
  or absent_staff_id = auth.uid()
  or substitute_staff_id = auth.uid()
);
drop policy if exists substitutions_manage on public.staff_substitutions;
create policy substitutions_manage on public.staff_substitutions for all to authenticated
using (public.is_platform_admin() or public.can_lead_school(school_id))
with check (public.is_platform_admin() or public.can_lead_school(school_id));

-- Documents.
drop policy if exists school_documents_read on public.school_documents;
create policy school_documents_read on public.school_documents for select to authenticated
using (
  public.is_platform_admin()
  or public.can_manage_school(school_id)
  or (student_id is not null and public.can_access_student(student_id))
);
drop policy if exists school_documents_manage on public.school_documents;
create policy school_documents_manage on public.school_documents for all to authenticated
using (public.is_platform_admin() or public.can_manage_school(school_id))
with check (public.is_platform_admin() or public.can_manage_school(school_id));

-- Notifications.
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated
using (
  user_id = auth.uid()
  or public.is_platform_admin()
  or (school_id is not null and public.can_lead_school(school_id))
);
drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications for insert to authenticated
with check (
  public.is_platform_admin()
  or (school_id is not null and public.can_manage_school(school_id))
);
drop policy if exists notifications_update_self on public.notifications;
create policy notifications_update_self on public.notifications for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Support tickets.
drop policy if exists support_tickets_read on public.support_tickets;
create policy support_tickets_read on public.support_tickets for select to authenticated
using (user_id = auth.uid() or public.is_platform_admin());
drop policy if exists support_tickets_insert on public.support_tickets;
create policy support_tickets_insert on public.support_tickets for insert to authenticated
with check (user_id = auth.uid());
drop policy if exists support_tickets_update on public.support_tickets;
create policy support_tickets_update on public.support_tickets for update to authenticated
using (public.is_platform_admin() or (user_id = auth.uid() and status in ('open','in_progress')))
with check (public.is_platform_admin() or user_id = auth.uid());

-- Platform subscription plans and invoices.
drop policy if exists subscription_plans_read on public.platform_subscription_plans;
create policy subscription_plans_read on public.platform_subscription_plans for select to authenticated
using (active or public.is_platform_admin());
drop policy if exists subscription_plans_manage on public.platform_subscription_plans;
create policy subscription_plans_manage on public.platform_subscription_plans for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists subscription_invoices_read on public.platform_subscription_invoices;
create policy subscription_invoices_read on public.platform_subscription_invoices for select to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1 from public.school_memberships m
    where m.school_id = platform_subscription_invoices.school_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = 'school_admin'
  )
);
drop policy if exists subscription_invoices_manage on public.platform_subscription_invoices;
create policy subscription_invoices_manage on public.platform_subscription_invoices for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- ADDITIONAL POLICIES ON EXISTING TABLES
-- ---------------------------------------------------------------------------

-- Teachers may read their own assignments; learners see published work for their class.
drop policy if exists assignments_teacher_read on public.assignments;
create policy assignments_teacher_read on public.assignments for select to authenticated
using (
  teacher_id = auth.uid()
  and public.has_school_role(school_id, array['teacher']::public.platform_user_role[])
);

drop policy if exists assignments_participant_read on public.assignments;
create policy assignments_participant_read on public.assignments for select to authenticated
using (
  public.is_platform_admin()
  or public.can_manage_school(school_id)
  or (
    status = 'published'
    and (
      exists (
        select 1 from public.students st
        where st.school_id = assignments.school_id
          and st.class_id = assignments.class_id
          and st.user_id = auth.uid()
          and st.status = 'active'
      )
      or exists (
        select 1
        from public.guardians g
        join public.student_guardians sg on sg.guardian_id = g.id
        join public.students st on st.id = sg.student_id
        where g.user_id = auth.uid()
          and st.class_id = assignments.class_id
          and st.school_id = assignments.school_id
          and st.status = 'active'
      )
    )
  )
);

-- Teachers may publish/update their own assignments.
drop policy if exists assignments_teacher_update on public.assignments;
create policy assignments_teacher_update on public.assignments for update to authenticated
using (
  teacher_id = auth.uid()
  and public.has_school_role(school_id, array['teacher']::public.platform_user_role[])
)
with check (
  teacher_id = auth.uid()
  and public.has_school_role(school_id, array['teacher']::public.platform_user_role[])
);

-- Students and guardians may read attendance for the learners they can access.
drop policy if exists attendance_records_family_read on public.attendance_records;
create policy attendance_records_family_read on public.attendance_records for select to authenticated
using (
  public.is_platform_admin()
  or public.can_manage_school(school_id)
  or public.can_access_student(student_id)
);

-- Learners and guardians may read the book catalogue and books issued to them.
drop policy if exists textbooks_participant_read on public.textbooks;
create policy textbooks_participant_read on public.textbooks for select to authenticated
using (public.is_platform_admin() or public.is_school_participant(school_id));

drop policy if exists textbook_issues_family_read on public.textbook_issues;
create policy textbook_issues_family_read on public.textbook_issues for select to authenticated
using (
  public.is_platform_admin()
  or public.can_manage_school(school_id)
  or public.can_access_student(student_id)
);

-- Teachers may issue books to students they can access.
drop policy if exists textbook_issues_teacher_insert on public.textbook_issues;
create policy textbook_issues_teacher_insert on public.textbook_issues for insert to authenticated
with check (
  issued_by = auth.uid()
  and public.has_school_role(school_id, array['teacher']::public.platform_user_role[])
  and public.can_access_student(student_id)
);

-- Teachers may create their own leave requests.
drop policy if exists staff_leave_teacher_insert on public.staff_leave_requests;
create policy staff_leave_teacher_insert on public.staff_leave_requests for insert to authenticated
with check (
  staff_user_id = auth.uid()
  and public.has_school_role(school_id, array['teacher']::public.platform_user_role[])
);
drop policy if exists staff_leave_teacher_update on public.staff_leave_requests;
create policy staff_leave_teacher_update on public.staff_leave_requests for update to authenticated
using (staff_user_id = auth.uid() and status = 'pending')
with check (staff_user_id = auth.uid());

-- Substitute teachers may view arrangements involving them.
drop policy if exists substitutions_substitute_read on public.staff_substitutions;
create policy substitutions_substitute_read on public.staff_substitutions for select to authenticated
using (absent_staff_id = auth.uid() or substitute_staff_id = auth.uid());

-- Events and announcements visible to school participants.
drop policy if exists school_events_participant_read on public.school_events;
create policy school_events_participant_read on public.school_events for select to authenticated
using (public.is_platform_admin() or public.is_school_participant(school_id));

drop policy if exists school_messages_participant_read on public.school_messages;
create policy school_messages_participant_read on public.school_messages for select to authenticated
using (
  public.is_platform_admin()
  or public.can_manage_school(school_id)
  or (
    coalesce(audience->>'audience', 'all') = 'all'
    and public.is_school_participant(school_id)
  )
  or (
    coalesce(audience->>'audience', 'all') in ('staff','teachers')
    and exists (
      select 1 from public.school_memberships m
      where m.school_id = school_messages.school_id
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role = 'teacher'
    )
  )
  or (
    coalesce(audience->>'audience', 'all') = 'students'
    and exists (
      select 1 from public.students st
      where st.school_id = school_messages.school_id
        and st.user_id = auth.uid()
        and st.status = 'active'
    )
  )
  or (
    coalesce(audience->>'audience', 'all') = 'parents'
    and exists (
      select 1 from public.guardians g
      join public.student_guardians sg on sg.guardian_id = g.id
      join public.students st on st.id = sg.student_id
      where g.school_id = school_messages.school_id
        and g.user_id = auth.uid()
        and st.status = 'active'
    )
  )
);

-- Students/guardians may read their own fee charges, allocations and fee items.
drop policy if exists fee_items_participant_read on public.fee_items;
create policy fee_items_participant_read on public.fee_items for select to authenticated
using (public.is_platform_admin() or public.is_school_participant(school_id));

drop policy if exists fee_charges_participant_read on public.fee_charges;
create policy fee_charges_participant_read on public.fee_charges for select to authenticated
using (
  public.is_platform_admin()
  or public.can_manage_school(school_id)
  or public.can_access_student(student_id)
);

drop policy if exists payment_allocations_participant_read on public.payment_allocations;
create policy payment_allocations_participant_read on public.payment_allocations for select to authenticated
using (
  public.is_platform_admin()
  or public.can_manage_school(school_id)
  or exists (
    select 1 from public.fee_charges fc
    where fc.id = payment_allocations.fee_charge_id
      and fc.school_id = payment_allocations.school_id
      and public.can_access_student(fc.student_id)
  )
);

-- ---------------------------------------------------------------------------
-- STORAGE BUCKET FOR LEARNING MATERIALS
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'learning-materials',
  'learning-materials',
  false,
  20971520,
  array['application/pdf','image/jpeg','image/png','image/webp','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do update
set public = false,
    file_size_limit = 20971520;

drop policy if exists learning_materials_storage_read on storage.objects;
create policy learning_materials_storage_read
on storage.objects for select to authenticated
using (
  bucket_id = 'learning-materials'
  and (
    public.is_platform_admin()
    or public.can_manage_school(public.uuid_or_null((storage.foldername(name))[1]))
    or public.is_school_participant(public.uuid_or_null((storage.foldername(name))[1]))
  )
);

drop policy if exists learning_materials_storage_write on storage.objects;
create policy learning_materials_storage_write
on storage.objects for insert to authenticated
with check (
  bucket_id = 'learning-materials'
  and (
    public.is_platform_admin()
    or public.can_manage_school(public.uuid_or_null((storage.foldername(name))[1]))
    or (
      public.has_school_role(public.uuid_or_null((storage.foldername(name))[1]), array['teacher']::public.platform_user_role[])
    )
  )
);

drop policy if exists learning_materials_storage_update on storage.objects;
create policy learning_materials_storage_update
on storage.objects for update to authenticated
using (
  bucket_id = 'learning-materials'
  and (
    public.is_platform_admin()
    or public.can_manage_school(public.uuid_or_null((storage.foldername(name))[1]))
    or public.has_school_role(public.uuid_or_null((storage.foldername(name))[1]), array['teacher']::public.platform_user_role[])
  )
)
with check (
  bucket_id = 'learning-materials'
  and (
    public.is_platform_admin()
    or public.can_manage_school(public.uuid_or_null((storage.foldername(name))[1]))
    or public.has_school_role(public.uuid_or_null((storage.foldername(name))[1]), array['teacher']::public.platform_user_role[])
  )
);

-- Family access to private school documents stored under school/student/...
drop policy if exists private_school_documents_family_read on storage.objects;
create policy private_school_documents_family_read
on storage.objects for select to authenticated
using (
  bucket_id = 'school-private-documents'
  and (storage.foldername(name))[2] is not null
  and public.can_access_student(public.uuid_or_null((storage.foldername(name))[2]))
);

-- ---------------------------------------------------------------------------
-- TRIGGERS
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists lesson_plans_updated_at on public.lesson_plans;
create trigger lesson_plans_updated_at before update on public.lesson_plans
for each row execute procedure public.set_updated_at();

drop trigger if exists assessments_updated_at on public.assessments;
create trigger assessments_updated_at before update on public.assessments
for each row execute procedure public.set_updated_at();

drop trigger if exists assessment_results_updated_at on public.assessment_results;
create trigger assessment_results_updated_at before update on public.assessment_results
for each row execute procedure public.set_updated_at();

create or replace function public.validate_assessment_result()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_max numeric;
  v_percentage numeric;
  v_grade text;
begin
  select max_marks into v_max from public.assessments where id = new.assessment_id;
  if v_max is null then
    raise exception 'Assessment not found';
  end if;
  if new.marks > v_max then
    raise exception 'Marks (%) cannot exceed the assessment maximum (%)', new.marks, v_max;
  end if;
  v_percentage := (new.marks / nullif(v_max, 0)) * 100;
  v_grade := case
    when v_percentage >= 80 then 'A'
    when v_percentage >= 70 then 'B'
    when v_percentage >= 60 then 'C'
    when v_percentage >= 50 then 'D'
    else 'E'
  end;
  new.grade := v_grade;
  return new;
end;
$$;

drop trigger if exists assessment_results_validate on public.assessment_results;
create trigger assessment_results_validate
before insert or update on public.assessment_results
for each row execute procedure public.validate_assessment_result();

-- Notify a student and linked guardians when an absence is recorded.
create or replace function public.notify_absence()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_student record;
  v_label text;
begin
  if new.status <> 'absent' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'absent' then
    return new;
  end if;

  select s.id, s.user_id, s.first_name, s.last_name, s.school_id
    into v_student
  from public.students s
  where s.id = new.student_id;

  if not found then return new; end if;
  v_label := v_student.first_name || ' ' || v_student.last_name;

  if v_student.user_id is not null then
    insert into public.notifications (school_id, user_id, title, body, category, link)
    values (
      v_student.school_id, v_student.user_id,
      'Marked absent', 'You were marked absent today.', 'attendance', 'attendance'
    );
  end if;

  insert into public.notifications (school_id, user_id, title, body, category, link)
  select v_student.school_id, g.user_id,
         'Absence recorded',
         v_label || ' was marked absent.',
         'attendance', 'attendance'
  from public.student_guardians sg
  join public.guardians g on g.id = sg.guardian_id
  where sg.student_id = v_student.id
    and g.user_id is not null;

  return new;
end;
$$;

drop trigger if exists attendance_notify_absence on public.attendance_records;
create trigger attendance_notify_absence
after insert or update of status on public.attendance_records
for each row execute procedure public.notify_absence();

-- ---------------------------------------------------------------------------
-- SECURE RPCs
-- ---------------------------------------------------------------------------

-- Student portal sign-in: maps an admission number to the linked auth email.
create or replace function public.resolve_student_login(p_admission_number text)
returns text
language sql stable security definer
set search_path = public, auth
as $$
  select u.email
  from public.students s
  join public.schools sc on sc.id = s.school_id
  join auth.users u on u.id = s.user_id
  where upper(s.admission_number) = upper(trim(p_admission_number))
    and s.status = 'active'
    and sc.status = 'active'
  limit 1;
$$;
revoke all on function public.resolve_student_login(text) from public;
grant execute on function public.resolve_student_login(text) to anon, authenticated;

-- Record a verified manual payment and allocate it to outstanding charges.
create or replace function public.record_manual_payment(
  p_school_id uuid,
  p_student_id uuid,
  p_amount numeric,
  p_method text default 'manual',
  p_reference text default null,
  p_notes text default null
)
returns uuid
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_intent_id uuid;
  v_remaining numeric;
  v_charge record;
  v_alloc numeric;
  v_receipt text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not (public.is_platform_admin() or public.can_manage_school(p_school_id)) then
    raise exception 'Not authorized to record payments for this school';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be greater than zero'; end if;
  if p_method not in ('manual','bank','daraja','cash','mpesa') then
    raise exception 'Unsupported payment method';
  end if;
  if not exists (
    select 1 from public.students s
    where s.id = p_student_id and s.school_id = p_school_id
  ) then
    raise exception 'Student does not belong to this school';
  end if;

  insert into public.payment_intents (
    school_id, student_id, provider, amount_kes, maintenance_fee_kes,
    status, account_reference, provider_receipt, initiated_by, verified_at, failure_reason
  )
  values (
    p_school_id, p_student_id,
    case when p_method = 'bank' then 'bank' when p_method = 'daraja' then 'daraja' else 'manual' end,
    p_amount, 0, 'succeeded',
    coalesce(p_reference, 'MAN-' || to_char(now(), 'YYYYMMDDHH24MISS')),
    p_reference, auth.uid(), now(), p_notes
  )
  returning id into v_intent_id;

  v_remaining := p_amount;

  for v_charge in
    select fc.id, fc.amount_kes
    from public.fee_charges fc
    where fc.school_id = p_school_id
      and fc.student_id = p_student_id
      and fc.amount_kes > coalesce((
        select sum(pa.amount_kes) from public.payment_allocations pa
        where pa.fee_charge_id = fc.id
      ), 0)
    order by fc.due_date nulls last, fc.created_at
  loop
    exit when v_remaining <= 0;
    v_alloc := least(
      v_remaining,
      v_charge.amount_kes - coalesce((
        select sum(pa.amount_kes) from public.payment_allocations pa
        where pa.fee_charge_id = v_charge.id
      ), 0)
    );
    if v_alloc > 0 then
      insert into public.payment_allocations (school_id, payment_intent_id, fee_charge_id, amount_kes)
      values (p_school_id, v_intent_id, v_charge.id, v_alloc);
      v_remaining := v_remaining - v_alloc;
    end if;
  end loop;

  v_receipt := 'RCT-' || to_char(now(), 'YYYYMMDD') || '-' ||
    upper(substr(replace(v_intent_id::text, '-', ''), 1, 8));

  insert into public.receipts (
    school_id, payment_intent_id, student_id, receipt_number, amount_kes, issued_by, notes
  )
  values (p_school_id, v_intent_id, p_student_id, v_receipt, p_amount, auth.uid(), p_notes);

  insert into public.audit_logs (school_id, actor_user_id, action, entity_type, entity_id, after_data)
  values (
    p_school_id, auth.uid(), 'manual_payment_recorded', 'payment_intent', v_intent_id,
    jsonb_build_object('amount_kes', p_amount, 'method', p_method, 'reference', p_reference, 'receipt', v_receipt)
  );

  return v_intent_id;
end;
$$;
revoke all on function public.record_manual_payment(uuid, uuid, numeric, text, text, text) from public, anon;
grant execute on function public.record_manual_payment(uuid, uuid, numeric, text, text, text) to authenticated;

-- Verify a submitted payment reference and post it atomically to the ledger.
create or replace function public.verify_payment_submission(p_queue_id uuid)
returns uuid
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_row public.payment_verification_queue%rowtype;
  v_payment_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into v_row
  from public.payment_verification_queue
  where id = p_queue_id
  for update;

  if not found then raise exception 'Payment submission not found'; end if;
  if not (public.is_platform_admin() or public.can_manage_school(v_row.school_id)) then
    raise exception 'Not authorized to verify payments for this school';
  end if;
  if v_row.status <> 'awaiting_verification' then
    raise exception 'This payment submission has already been reviewed';
  end if;

  v_payment_id := public.record_manual_payment(
    v_row.school_id,
    v_row.student_id,
    v_row.amount_kes,
    v_row.provider,
    v_row.reference,
    v_row.notes
  );

  update public.payment_verification_queue
  set status = 'verified', verified_by = auth.uid(), verified_at = now()
  where id = v_row.id;

  return v_payment_id;
end;
$$;
revoke all on function public.verify_payment_submission(uuid) from public, anon;
grant execute on function public.verify_payment_submission(uuid) to authenticated;

-- Publish assessment results (principal / school admin) and notify recipients.
create or replace function public.publish_assessment_results(p_assessment_id uuid)
returns void
language plpgsql security definer
set search_path = public, auth
as $$
declare
  a public.assessments%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into a from public.assessments where id = p_assessment_id for update;
  if not found then raise exception 'Assessment not found'; end if;
  if not (public.is_platform_admin() or public.can_lead_school(a.school_id)) then
    raise exception 'Only the principal or school administrator can publish results';
  end if;
  if a.status = 'published' then return; end if;

  update public.assessments
  set status = 'published', published_at = now(), published_by = auth.uid(), updated_at = now()
  where id = a.id;

  insert into public.notifications (school_id, user_id, title, body, category, link)
  select a.school_id, st.user_id,
         'Results published',
         'Results for ' || a.title || ' have been published.',
         'academic', 'examination-results'
  from public.students st
  where st.school_id = a.school_id
    and st.class_id = a.class_id
    and st.status = 'active'
    and st.user_id is not null;

  insert into public.notifications (school_id, user_id, title, body, category, link)
  select a.school_id, g.user_id,
         'Results published',
         'Results for ' || a.title || ' have been published.',
         'academic', 'examination-results'
  from public.student_guardians sg
  join public.guardians g on g.id = sg.guardian_id
  join public.students st on st.id = sg.student_id
  where st.school_id = a.school_id
    and st.class_id = a.class_id
    and st.status = 'active'
    and g.user_id is not null;

  insert into public.audit_logs (school_id, actor_user_id, action, entity_type, entity_id, after_data)
  values (a.school_id, auth.uid(), 'results_published', 'assessment', a.id,
          jsonb_build_object('title', a.title));
end;
$$;
revoke all on function public.publish_assessment_results(uuid) from public, anon;
grant execute on function public.publish_assessment_results(uuid) to authenticated;

-- Create a timetable slot with class/teacher overlap validation.
create or replace function public.create_timetable_slot(
  p_school_id uuid,
  p_class_id uuid,
  p_subject_id uuid,
  p_teacher_id uuid,
  p_day_of_week int,
  p_start_time time,
  p_end_time time,
  p_room text default null,
  p_term_id uuid default null,
  p_academic_year_id uuid default null
)
returns uuid
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not (public.is_platform_admin() or public.can_manage_school(p_school_id)) then
    raise exception 'Not authorized to manage timetables for this school';
  end if;
  if p_day_of_week not between 1 and 7 then raise exception 'Invalid day of week'; end if;
  if p_end_time <= p_start_time then raise exception 'End time must be after start time'; end if;
  if not exists (select 1 from public.classes c where c.id = p_class_id and c.school_id = p_school_id) then
    raise exception 'Class does not belong to this school';
  end if;
  if p_subject_id is not null and not exists (
    select 1 from public.subjects sub where sub.id = p_subject_id and sub.school_id = p_school_id
  ) then
    raise exception 'Subject does not belong to this school';
  end if;
  if p_teacher_id is not null and not exists (
    select 1 from public.school_memberships m
    where m.school_id = p_school_id and m.user_id = p_teacher_id and m.status = 'active'
  ) then
    raise exception 'Teacher is not an active member of this school';
  end if;

  if exists (
    select 1 from public.timetable_slots t
    where t.school_id = p_school_id
      and t.day_of_week = p_day_of_week
      and t.class_id = p_class_id
      and t.start_time < p_end_time
      and t.end_time > p_start_time
  ) then
    raise exception 'This class already has a lesson during that time';
  end if;

  if p_teacher_id is not null and exists (
    select 1 from public.timetable_slots t
    where t.school_id = p_school_id
      and t.day_of_week = p_day_of_week
      and t.teacher_id = p_teacher_id
      and t.start_time < p_end_time
      and t.end_time > p_start_time
  ) then
    raise exception 'This teacher already has a lesson during that time';
  end if;

  insert into public.timetable_slots (
    school_id, academic_year_id, term_id, class_id, subject_id, teacher_id,
    day_of_week, start_time, end_time, room, created_by
  )
  values (
    p_school_id, p_academic_year_id, p_term_id, p_class_id, p_subject_id, p_teacher_id,
    p_day_of_week, p_start_time, p_end_time, p_room, auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.create_timetable_slot(uuid, uuid, uuid, uuid, int, time, time, text, uuid, uuid) from public, anon;
grant execute on function public.create_timetable_slot(uuid, uuid, uuid, uuid, int, time, time, text, uuid, uuid) to authenticated;

-- Generate draft report cards for a term from published assessment results.
create or replace function public.generate_report_cards(p_school_id uuid, p_term_id uuid)
returns int
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_count int := 0;
  r record;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not (public.is_platform_admin() or public.can_lead_school(p_school_id)) then
    raise exception 'Only the principal or school administrator can generate report cards';
  end if;

  for r in
    select st.id as student_id, avg((ar.marks / a.max_marks) * 100) as average
    from public.students st
    join public.assessment_results ar on ar.student_id = st.id
    join public.assessments a on a.id = ar.assessment_id
    where st.school_id = p_school_id
      and st.status = 'active'
      and a.status = 'published'
      and (p_term_id is null or a.term_id = p_term_id)
    group by st.id
  loop
    insert into public.report_cards (
      school_id, student_id, term_id, average_marks, grade, status
    )
    values (
      p_school_id, r.student_id, p_term_id, round(r.average, 2),
      case
        when r.average >= 80 then 'A'
        when r.average >= 70 then 'B'
        when r.average >= 60 then 'C'
        when r.average >= 50 then 'D'
        else 'E'
      end,
      'draft'
    )
    on conflict (student_id, term_id) do update
    set average_marks = excluded.average_marks,
        grade = excluded.grade;
    v_count := v_count + 1;
  end loop;

  insert into public.audit_logs (school_id, actor_user_id, action, entity_type, after_data)
  values (p_school_id, auth.uid(), 'report_cards_generated', 'report_card',
          jsonb_build_object('term_id', p_term_id, 'count', v_count));

  return v_count;
end;
$$;
revoke all on function public.generate_report_cards(uuid, uuid) from public, anon;
grant execute on function public.generate_report_cards(uuid, uuid) to authenticated;

-- Create a notification for the current user's school audience.
create or replace function public.send_school_notification(
  p_school_id uuid,
  p_title text,
  p_body text,
  p_audience text default 'all',
  p_category text default 'general'
)
returns int
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_count int := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not (public.is_platform_admin() or public.can_manage_school(p_school_id)) then
    raise exception 'Not authorized to send notifications for this school';
  end if;
  if nullif(trim(p_title), '') is null then raise exception 'Title is required'; end if;
  if p_audience not in ('all','staff','teachers','students','parents') then
    raise exception 'Unsupported audience';
  end if;

  if p_audience in ('all','staff','teachers') then
    insert into public.notifications (school_id, user_id, title, body, category)
    select p_school_id, m.user_id, p_title, p_body, p_category
    from public.school_memberships m
    where m.school_id = p_school_id
      and m.status = 'active'
      and (
        p_audience = 'all'
        or (p_audience = 'teachers' and m.role = 'teacher')
        or (p_audience = 'staff' and m.role in ('school_admin','principal','secretary','teacher'))
      );
    get diagnostics v_count = row_count;
  end if;

  if p_audience in ('all','students') then
    insert into public.notifications (school_id, user_id, title, body, category)
    select p_school_id, st.user_id, p_title, p_body, p_category
    from public.students st
    where st.school_id = p_school_id
      and st.status = 'active'
      and st.user_id is not null;
  end if;

  if p_audience in ('all','parents') then
    insert into public.notifications (school_id, user_id, title, body, category)
    select p_school_id, g.user_id, p_title, p_body, p_category
    from public.guardians g
    join public.student_guardians sg on sg.guardian_id = g.id
    join public.students st on st.id = sg.student_id
    where g.school_id = p_school_id
      and st.status = 'active'
      and g.user_id is not null;
  end if;

  insert into public.school_messages (school_id, sender_id, title, body, audience, sent_at)
  values (p_school_id, auth.uid(), p_title, p_body, jsonb_build_object('audience', p_audience), now());

  return v_count;
end;
$$;
revoke all on function public.send_school_notification(uuid, text, text, text, text) from public, anon;
grant execute on function public.send_school_notification(uuid, text, text, text, text) to authenticated;

-- Approve or reject a school administrator request (platform RPC already exists;
-- this wrapper keeps the caller-facing signature used by the UI).
-- Existing: platform_review_school_admin_request(p_request_id, p_decision, p_notes).
