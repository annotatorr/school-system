-- Transactional workflows for admission approval, teacher sign-up review and Daraja callback finalization.
-- Apply after 202610230001_initial_schema.sql.
create table if not exists public.school_counters (
  school_id uuid not null references public.schools(id) on delete cascade,
  counter_name text not null,
  counter_value bigint not null default 0 check(counter_value>=0),
  updated_at timestamptz not null default now(),
  primary key(school_id,counter_name)
);
alter table public.school_counters enable row level security;
create policy school_counters_admin_read on public.school_counters for select to authenticated
using (public.is_platform_admin() or public.has_school_role(school_id,array['school_admin','principal','secretary']::public.platform_user_role[]));

-- Atomic admission approval. Official admission number is created only after approval.
create or replace function public.approve_admission_application(p_application_id uuid,p_reviewer uuid)
returns table(created_student_id uuid, created_admission_number text)
language plpgsql security definer set search_path=public,auth as $$
declare
  a public.admission_applications%rowtype;
  school_slug text;
  next_value bigint;
  new_number text;
  new_student_id uuid;
  new_guardian_id uuid;
begin
  select * into a from public.admission_applications where id=p_application_id for update;
  if not found then raise exception 'Admission application not found'; end if;
  if a.status='approved' and a.approved_student_id is not null then
    select s.admission_number into new_number from public.students s where s.id=a.approved_student_id;
    return query select a.approved_student_id,new_number; return;
  end if;
  if a.status not in ('submitted','under_review','needs_correction') then raise exception 'Application cannot be approved from status %',a.status; end if;
  if not exists(select 1 from public.school_memberships m where m.school_id=a.school_id and m.user_id=p_reviewer and m.status='active' and m.role in ('secretary','principal','school_admin')) then
    raise exception 'Reviewer is not authorized to approve admissions for this school';
  end if;
  if not exists(select 1 from public.schools s where s.id=a.school_id and s.status='active') then raise exception 'School is not active'; end if;
  select slug into school_slug from public.schools where id=a.school_id;
  insert into public.school_counters(school_id,counter_name,counter_value) values(a.school_id,'admission',1)
    on conflict(school_id,counter_name) do update set counter_value=public.school_counters.counter_value+1,updated_at=now()
    returning counter_value into next_value;
  new_number := 'ADM-' || upper(substr(regexp_replace(school_slug,'[^a-zA-Z0-9]','','g'),1,6)) || '-' || to_char(current_date,'YYYY') || '-' || lpad(next_value::text,6,'0');
  insert into public.students(school_id,class_id,admission_number,first_name,middle_name,last_name,date_of_birth,admission_date,created_by,status)
  values(a.school_id,a.requested_class_id,new_number,a.student_first_name,a.student_middle_name,a.student_last_name,a.date_of_birth,current_date,p_reviewer,'active')
  returning id into new_student_id;
  if coalesce(a.submitted_by_phone,'')<>'' then
    if a.guardian_user_id is not null then
      insert into public.guardians(school_id,user_id,full_name,phone)
      values(a.school_id,a.guardian_user_id,coalesce(nullif(a.submitted_by_name,''),'Parent / Guardian'),a.submitted_by_phone)
      on conflict(school_id,user_id) do update set full_name=excluded.full_name,phone=excluded.phone
      returning id into new_guardian_id;
    else
      insert into public.guardians(school_id,full_name,phone)
      values(a.school_id,coalesce(nullif(a.submitted_by_name,''),'Parent / Guardian'),a.submitted_by_phone)
      returning id into new_guardian_id;
    end if;
    insert into public.student_guardians(school_id,student_id,guardian_id,is_primary)
    values(a.school_id,new_student_id,new_guardian_id,true) on conflict(student_id,guardian_id) do nothing;
  end if;
  update public.admission_applications set status='approved',reviewed_by=p_reviewer,reviewed_at=now(),approved_student_id=new_student_id,updated_at=now() where id=a.id;
  insert into public.audit_logs(school_id,actor_user_id,action,entity_type,entity_id,after_data)
  values(a.school_id,p_reviewer,'admission_approved','admission_application',a.id,jsonb_build_object('student_id',new_student_id,'admission_number',new_number));
  return query select new_student_id,new_number;
end; $$;
revoke all on function public.approve_admission_application(uuid,uuid) from public,anon,authenticated;
grant execute on function public.approve_admission_application(uuid,uuid) to service_role;

-- Only a secretary can decide teacher sign-up requests, as required by the workflow.
create or replace function public.review_teacher_application(p_application_id uuid,p_reviewer uuid,p_decision public.teacher_application_status,p_notes text default null)
returns void language plpgsql security definer set search_path=public,auth as $$
declare a public.teacher_applications%rowtype;
begin
  if p_decision not in ('approved','rejected') then raise exception 'Decision must be approved or rejected'; end if;
  select * into a from public.teacher_applications where id=p_application_id for update;
  if not found then raise exception 'Teacher application not found'; end if;
  if not exists(select 1 from public.school_memberships m where m.school_id=a.school_id and m.user_id=p_reviewer and m.status='active' and m.role='secretary') then
    raise exception 'Only an active secretary for this school can approve or reject teacher sign-ups';
  end if;
  if a.status<>'pending' then raise exception 'Teacher application has already been decided'; end if;
  update public.teacher_applications set status=p_decision,decision_notes=p_notes,decided_by=p_reviewer,decided_at=now() where id=a.id;
  insert into public.school_memberships(school_id,user_id,role,status,approved_by,approved_at)
  values(a.school_id,a.user_id,'teacher',case when p_decision='approved' then 'active' else 'rejected' end,p_reviewer,now())
  on conflict(school_id,user_id,role) do update set status=excluded.status,approved_by=excluded.approved_by,approved_at=excluded.approved_at;
  insert into public.audit_logs(school_id,actor_user_id,action,entity_type,entity_id,after_data)
  values(a.school_id,p_reviewer,'teacher_application_'||p_decision::text,'teacher_application',a.id,jsonb_build_object('teacher_user_id',a.user_id,'notes',p_notes));
end; $$;
revoke all on function public.review_teacher_application(uuid,uuid,public.teacher_application_status,text) from public,anon,authenticated;
grant execute on function public.review_teacher_application(uuid,uuid,public.teacher_application_status,text) to service_role;

-- Atomic and idempotent Daraja result finalization. The KSh 7 fee is recorded separately, not silently deducted or added.
create or replace function public.finalize_daraja_payment(p_checkout_id text,p_result_code integer,p_result_desc text,p_receipt text,p_metadata jsonb default '{}'::jsonb)
returns text language plpgsql security definer set search_path=public,auth as $$
declare p public.payment_intents%rowtype; final_status public.payment_status;
begin
  select * into p from public.payment_intents where provider='daraja' and provider_checkout_id=p_checkout_id for update;
  if not found then return 'not_found'; end if;
  if p.status in ('succeeded','failed','cancelled','reversed') then return 'already_final'; end if;
  if p_result_code=0 then
    if coalesce(p_receipt,'')='' then raise exception 'Successful payment callback requires an M-Pesa receipt'; end if;
    update public.payment_intents set status='succeeded',provider_receipt=p_receipt,provider_transaction_id=p_receipt,verified_at=now(),failure_reason=null,provider_payload=jsonb_build_object('ResultCode',p_result_code,'ResultDesc',p_result_desc,'metadata',p_metadata),updated_at=now() where id=p.id;
    if p.maintenance_fee_kes>0 then
      insert into public.platform_revenue_entries(school_id,payment_intent_id,entry_type,amount_kes,status,note)
      values(p.school_id,p.id,'maintenance_fee',p.maintenance_fee_kes,'pending','Recorded separately; settlement method must be configured');
    end if;
    return 'succeeded';
  else
    final_status:=case when p_result_code=1032 then 'cancelled'::public.payment_status else 'failed'::public.payment_status end;
    update public.payment_intents set status=final_status,failure_reason=coalesce(p_result_desc,'Payment failed'),provider_payload=jsonb_build_object('ResultCode',p_result_code,'ResultDesc',p_result_desc,'metadata',p_metadata),updated_at=now() where id=p.id;
    return final_status::text;
  end if;
end; $$;
revoke all on function public.finalize_daraja_payment(text,integer,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.finalize_daraja_payment(text,integer,text,text,jsonb) to service_role;
