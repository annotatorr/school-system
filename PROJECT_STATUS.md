# Project status — milestone 2: separate portal shells

## Present in source
- [x] Seven independent Vite app roots with their own HTML entry, title, ports, and role-specific config.
- [x] No cross-portal switcher in Parent/Student pages.
- [x] Shared responsive login, dashboard, navigation, and profile page.
- [x] Profile photo field/upload button in every portal; client-side preview and Supabase Storage upload flow.
- [x] SQL migration adding `profiles.avatar_url`, private photo bucket, and own-folder storage policies.
- [x] Existing database migrations and starter server functions retained from milestone 1.
- [x] Source-only package; no `node_modules`, binaries, or bundled executables.

## Not yet production complete
- [x] Run `npm install` and verify all seven app builds in the user's Windows environment. (2026-11-06: `npm run typecheck` and `npm run build` both pass for all seven workspaces.)
- [x] Apply the operational migration `202610270001_full_school_operations.sql` (applied 2026-11-06; live tables and RPCs verified).
- [ ] Implement complete user onboarding and portal-specific account invitation/provisioning.
- [ ] Implement platform-admin account/bootstrap separately from school membership roles.
- [ ] Complete all role-specific CRUD, admission submission, fees, accounting, academics, textbook workflows and notifications.
- [ ] Complete backend authorization and school-isolation tests; review all RLS policies.
- [ ] Select bank provider, configure payment secrets, and complete sandbox reconciliation.
- [ ] Configure domain, DNS, hosting and auth redirect URLs for seven sites.
- [ ] Perform accessibility, privacy, backup/restore, load, and security reviews.

## Verified live database state (2026-11-06)

- **`202610270001_full_school_operations.sql` applied successfully** ("Success. No rows returned").
- REST checks against `https://jcianderinvjoxjgckyz.supabase.co` now return HTTP 200 for the operational tables: `academic_years`, `terms`, `assessments`, `assessment_results`, `timetable_slots`, `notifications`, `platform_subscription_plans`, `platform_subscription_invoices`, `platform_settings`, `support_tickets`, `learning_materials`, `receipts`, `payment_verification_queue`, `report_cards`, `exam_types`, `transport_routes`, `transport_vehicles`, `student_transport`, `inventory_items`, `meal_programmes`, `meal_participation`, `discipline_incidents`, `welfare_notes`, `staff_substitutions`, `school_documents`, `admission_form_fields` and `fee_discounts`.
- `can_manage_school`, `is_school_participant` and the operational RPCs exist; unauthenticated calls are correctly rejected with `permission denied for function`, confirming the functions are installed.
- Remaining verification requires authenticated test accounts for each portal.

## Session fixes (2026-11-06)

- Parent "linked children"/records view now filters `student_guardians` by the signed-in parent's guardian IDs instead of every link in the school.
- Teacher "student records" now filters students to classes the teacher is assigned to.
- Removed a duplicated Subjects list in `PortalModulePage` that rendered modified rows without actions.
- Wired previously dead top-bar Help and Notifications buttons to the portal's Support/Notifications pages (disabled when the portal has no such area), and removed the permanent fake unread dot.
- Overview statistics are now loaded from real, school-scoped queries for school-admin, principal, secretary, teacher, student and parent instead of always showing `—`.
- Fixed admission "pending" statistics: `admission_status` has no `pending` value, so counts now use `submitted`, `under_review` and `needs_correction`.
- Hardened `school_messages` RLS in the pending migration so audience-scoped notices (`staff`, `teachers`, `students`, `parents`) are not visible to unrelated participants.

## Profile photo behavior
The page exists in every site. With Supabase configured, it uploads to a private bucket under the signed-in user's UUID and stores the path in `profiles.avatar_url`. Without backend configuration, it only shows a local image preview and a message explaining that it has not been saved. Signed URLs are short-lived and loaded when the profile is fetched.
