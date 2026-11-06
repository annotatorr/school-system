# Schhol System — Specification Feature Checklist

Statuses: **COMPLETE AND TESTED** · **IMPLEMENTED BUT NOT TESTED** · **PARTIALLY IMPLEMENTED** · **MISSING** · **BLOCKED**

Last updated after the full-specification audit and the Stage 2–6 implementation pass, including platform admin sections, results/report panels, fee statements/payments, staff leave and substitution workflows, inventory navigation, and parent child selection.

## Stage 1 — Project audit

| Item | Status | Notes |
|---|---|---|
| Seven independent Vite apps | COMPLETE AND TESTED | Separate ports, titles and configs. |
| Shared portal UI package | COMPLETE AND TESTED | `packages/portal-ui/src`. |
| Supabase client / env | COMPLETE AND TESTED | Publishable key only. |
| Database schema (base) | PARTIALLY IMPLEMENTED | Base schema existed; many spec domains were missing. Added in `202610270001`. |
| RLS on every school table | PARTIALLY IMPLEMENTED | Base tables covered; new tables now covered. Needs live DB testing. |
| Secure RPCs | PARTIALLY IMPLEMENTED | Platform + admission + teacher review existed; added operational RPCs. |
| Edge Functions | PARTIALLY IMPLEMENTED | Admission, teacher review, Daraja, bank, AI exist; need sandbox secrets/tests. |
| Real module UI wired into portals | PARTIALLY IMPLEMENTED | `PortalModulePage` existed but was never imported. Now wired through `PortalWorkspace`. |
| Build / typecheck | COMPLETE AND TESTED | `npm run typecheck` passes; production builds run per app. |

## Stage 2 — Architecture and stabilization

| Item | Status |
|---|---|
| Shared school-context resolution for staff/student/parent | IMPLEMENTED BUT NOT TESTED |
| Portal-specific authorization (staff, student, parent) | IMPLEMENTED BUT NOT TESTED |
| Student admission-number sign-in mapping | IMPLEMENTED BUT NOT TESTED |
| Shared workspace module renderer | IMPLEMENTED BUT NOT TESTED |
| Suspended-school notice | IMPLEMENTED BUT NOT TESTED |
| Remove dead/duplicate UI paths | IMPLEMENTED BUT NOT TESTED |

## Stage 3 — Platform Administrator

| Feature | Status |
|---|---|
| Dashboard statistics from DB | IMPLEMENTED BUT NOT TESTED |
| School registration (transactional RPC) | IMPLEMENTED BUT NOT TESTED |
| School directory / search / filters | IMPLEMENTED BUT NOT TESTED |
| Edit school details | PARTIALLY IMPLEMENTED |
| Activate / suspend / reactivate | IMPLEMENTED BUT NOT TESTED |
| School administrator request review | IMPLEMENTED BUT NOT TESTED |
| Subscription plan/status/dates | IMPLEMENTED BUT NOT TESTED |
| Subscription plans & invoices | IMPLEMENTED BUT NOT TESTED |
| Platform revenue view | IMPLEMENTED BUT NOT TESTED |
| Payments view | IMPLEMENTED BUT NOT TESTED |
| Users and accounts directory | IMPLEMENTED BUT NOT TESTED |
| Platform reports / CSV exports | IMPLEMENTED BUT NOT TESTED |
| Audit logs | IMPLEMENTED BUT NOT TESTED |
| System settings | IMPLEMENTED BUT NOT TESTED | 
| Support and issues | IMPLEMENTED BUT NOT TESTED |
| Announcements | PARTIALLY IMPLEMENTED (platform announcements page existed) |

## Stage 4 — School Administrator

| Feature | Status |
|---|---|
| School profile / branding | IMPLEMENTED BUT NOT TESTED |
| Students list / create / update / class assign | IMPLEMENTED BUT NOT TESTED |
| Admissions review | IMPLEMENTED BUT NOT TESTED |
| Parents and guardians | IMPLEMENTED BUT NOT TESTED |
| Staff and role assignment | IMPLEMENTED BUT NOT TESTED |
| Classes and streams | IMPLEMENTED BUT NOT TESTED |
| Subjects | IMPLEMENTED BUT NOT TESTED |
| Teacher assignments | IMPLEMENTED BUT NOT TESTED |
| Academic years and terms | IMPLEMENTED BUT NOT TESTED |
| Timetables | IMPLEMENTED BUT NOT TESTED |
| Examinations and results | IMPLEMENTED BUT NOT TESTED |
| Attendance overview | IMPLEMENTED BUT NOT TESTED |
| Fee items / charges / manual payments | IMPLEMENTED BUT NOT TESTED |
| Payments | IMPLEMENTED BUT NOT TESTED |
| Library catalogue / issues | IMPLEMENTED BUT NOT TESTED |
| Inventory | IMPLEMENTED BUT NOT TESTED |
| Transport | IMPLEMENTED BUT NOT TESTED |
| Meals | IMPLEMENTED BUT NOT TESTED |
| Staff leave | IMPLEMENTED BUT NOT TESTED |
| Discipline and welfare | IMPLEMENTED BUT NOT TESTED |
| Events and calendar | IMPLEMENTED BUT NOT TESTED |
| Documents | IMPLEMENTED BUT NOT TESTED |
| Reports / CSV | IMPLEMENTED BUT NOT TESTED |
| Notifications | IMPLEMENTED BUT NOT TESTED |
| School settings | IMPLEMENTED BUT NOT TESTED |
| Audit history | IMPLEMENTED BUT NOT TESTED |

## Stage 5 — Principal and Secretary

| Feature | Status |
|---|---|
| Principal dashboard statistics | IMPLEMENTED BUT NOT TESTED |
| Academic performance review | IMPLEMENTED BUT NOT TESTED |
| Attendance monitoring | IMPLEMENTED BUT NOT TESTED |
| Staff workload / leave approval | IMPLEMENTED BUT NOT TESTED |
| Discipline / welfare supervision | IMPLEMENTED BUT NOT TESTED |
| Result publication | IMPLEMENTED BUT NOT TESTED |
| Reports | IMPLEMENTED BUT NOT TESTED |
| Secretary admissions review | IMPLEMENTED BUT NOT TESTED |
| Student registration | IMPLEMENTED BUT NOT TESTED |
| Admission form builder | IMPLEMENTED BUT NOT TESTED |
| Teacher registration approval | IMPLEMENTED BUT NOT TESTED |
| Student / guardian records | IMPLEMENTED BUT NOT TESTED |
| Documents and certificates | IMPLEMENTED BUT NOT TESTED |
| Transfers and correspondence | IMPLEMENTED BUT NOT TESTED |

## Stage 6 — Teacher, Student, Parent

| Feature | Status |
|---|---|
| Teacher dashboard | IMPLEMENTED BUT NOT TESTED |
| Assigned classes / students / subjects | IMPLEMENTED BUT NOT TESTED |
| Attendance roster + save | IMPLEMENTED BUT NOT TESTED |
| Lesson plans | IMPLEMENTED BUT NOT TESTED |
| Teaching materials upload | IMPLEMENTED BUT NOT TESTED |
| Assignments / homework create & publish | IMPLEMENTED BUT NOT TESTED |
| CATs / assessments create | IMPLEMENTED BUT NOT TESTED |
| Marks entry | IMPLEMENTED BUT NOT TESTED |
| Results and report cards | IMPLEMENTED BUT NOT TESTED |
| Books issued | IMPLEMENTED BUT NOT TESTED |
| Student progress | IMPLEMENTED BUT NOT TESTED |
| Leave requests / substitutions | IMPLEMENTED BUT NOT TESTED |
| Student dashboard | IMPLEMENTED BUT NOT TESTED |
| Student assignments submission | IMPLEMENTED BUT NOT TESTED |
| Student attendance / results / report cards | IMPLEMENTED BUT NOT TESTED |
| Student library / fee statement | IMPLEMENTED BUT NOT TESTED (fee statement/payments wired; library view read-only) |
| Parent dashboard / child selection | IMPLEMENTED BUT NOT TESTED |
| Parent attendance / results / timetable | IMPLEMENTED BUT NOT TESTED |
| Parent fee statements / payments / receipts | IMPLEMENTED BUT NOT TESTED |
| Parent admission applications | IMPLEMENTED BUT NOT TESTED |
| Parent messages / notifications | IMPLEMENTED BUT NOT TESTED |

## Stage 7 — Shared modules

| Feature | Status |
|---|---|
| Timetable slot conflict validation | IMPLEMENTED BUT NOT TESTED |
| Library issue/return | IMPLEMENTED BUT NOT TESTED |
| Transport routes/vehicles/assignments | IMPLEMENTED BUT NOT TESTED |
| Inventory | IMPLEMENTED BUT NOT TESTED |
| Meals | IMPLEMENTED BUT NOT TESTED |
| Staff leave + substitution | IMPLEMENTED BUT NOT TESTED |
| Discipline / welfare | IMPLEMENTED BUT NOT TESTED |
| Events and calendar | IMPLEMENTED BUT NOT TESTED |
| Documents | IMPLEMENTED BUT NOT TESTED |
| Notifications + absent trigger | IMPLEMENTED BUT NOT TESTED |
| Reports / CSV exports | IMPLEMENTED BUT NOT TESTED |

## Stage 8 — Payments, AI, Notifications

| Feature | Status |
|---|---|
| Daraja STK push edge function | PARTIALLY IMPLEMENTED (needs secrets/sandbox) |
| Daraja callback finalisation | PARTIALLY IMPLEMENTED (needs secrets/sandbox) |
| Bank payment boundary | PARTIALLY IMPLEMENTED |
| Manual payment recording + allocation | IMPLEMENTED BUT NOT TESTED |
| Platform subscription invoices | IMPLEMENTED BUT NOT TESTED |
| AI draft generation | PARTIALLY IMPLEMENTED (needs AI secret; assignment draft flow) |
| AI slides / lesson plans | MISSING |
| Email / SMS / push delivery | MISSING (in-app only) |

## Stage 9 — Testing and deployment

| Item | Status |
|---|---|
| TypeScript typecheck | COMPLETE AND TESTED |
| Seven production builds | COMPLETE AND TESTED (see final report) |
| Cross-portal workflow tests | BLOCKED (needs live Supabase project seeded data) |
| RLS isolation tests | BLOCKED (needs live DB) |
| Payment sandbox tests | BLOCKED (needs Daraja/AI/provider secrets) |
| Deployment/DNS docs | PARTIALLY IMPLEMENTED (existing README) |

## Known blockers

- Migration `202610270001_full_school_operations.sql` **was applied on 2026-11-06** ("Success. No rows returned"). Live REST verification now returns 200 for `academic_years`, `terms`, `assessments`, `assessment_results`, `timetable_slots`, `notifications`, `platform_subscription_plans`, `platform_subscription_invoices`, `platform_settings`, `support_tickets`, `learning_materials`, `receipts`, `payment_verification_queue`, `report_cards`, `exam_types`, `transport_routes`, `transport_vehicles`, `student_transport`, `inventory_items`, `meal_programmes`, `meal_participation`, `discipline_incidents`, `welfare_notes`, `staff_substitutions`, `school_documents`, `admission_form_fields` and `fee_discounts`. The helper RPCs `can_manage_school` / `is_school_participant` and the operational RPCs now exist (anon receives the expected permission-denied response, confirming the functions are present).
- Live Supabase apply/migrations and seeded data are required to mark workflows **COMPLETE AND TESTED**.
- Payment and AI providers require server-side secrets and sandbox accounts.
- Email/SMS/push require provider credentials; in-app notifications are implemented.
