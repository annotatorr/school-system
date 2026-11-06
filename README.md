# Schhol System — seven separate school portals

This is a **source-code starter** for the multi-school school-management platform. It follows the separate-site structure used for the data-science portfolio: a monorepo with independent apps that can be run and deployed separately, plus shared UI code and a shared Supabase backend.

## The seven sites

| Portal | Local dev command | Local URL | Example production hostname |
|---|---|---|---|
| Platform Admin | `npm run dev:platform-admin` | `http://localhost:5173` | `platform.yourdomain.com` |
| School Administrator | `npm run dev:school-admin` | `http://localhost:5174` | `school-admin.yourdomain.com` |
| Principal | `npm run dev:principal` | `http://localhost:5175` | `principal.yourdomain.com` |
| Secretary | `npm run dev:secretary` | `http://localhost:5176` | `secretary.yourdomain.com` |
| Teacher | `npm run dev:teacher` | `http://localhost:5177` | `teacher.yourdomain.com` |
| Student | `npm run dev:student` | `http://localhost:5178` | `student.yourdomain.com` |
| Parent / Guardian | `npm run dev:parent` | `http://localhost:5179` | `parent.yourdomain.com` |

Each app has its own entry point, title, login page, navigation, and role-specific interface. There is **no portal-switching menu or link exposing other portals** inside the Parent or Student experience. In production, create a separate hosting project for each portal, keep the repository root as the build root so shared code remains available, and set that project’s build command/output to its own app. For example, Parent: build command `npm run build --workspace apps/parent`, output directory `apps/parent/dist`; repeat with the matching app name for the other six projects. Point each subdomain to its corresponding hosting project. The example domains are placeholders, not live links.

## Every account has a profile photo

Each portal includes a **My profile** page with a photo/avatar area, image upload button, name, email, and phone field. Photo files are limited to JPG, PNG, or WebP up to 3 MB. A migration adds `profiles.avatar_url` and a private `profile-photos` storage bucket with per-user folder policies. Photo upload persistence works only after Supabase is configured and migrations/policies are applied. Before configuration, the image can be previewed locally but is not saved to a server.

## Run on Windows / VS Code

Install a current Node.js LTS release first. Extract this folder and open **the root `schhol-system-rebuild` folder** in VS Code. In the VS Code terminal (PowerShell):

```powershell
npm install
Copy-Item .env.example .env
npm run dev:parent
```

Open the local URL printed by Vite (usually `http://localhost:5179`). To run another site, stop the current dev server with `Ctrl+C` and run its command from the table above. You can run multiple commands in separate terminals if you want to compare sites at the same time.

To build every site:

```powershell
npm run build
```

Each app has a separate port and can be run/build/deployed independently. The apps share UI code in `packages/portal-ui` and are configured to use the same Supabase project. That means they are separate **websites**, not seven unrelated databases.

## Connect the backend

1. Create a Supabase project.
2. Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from Supabase project settings.
3. Apply migrations in order to a new, reviewed database: `202610230001_initial_schema.sql`, `202610230002_workflows.sql`, `202610230003_profile_photos_and_portal_profiles.sql`, `202610250001_platform_admin_announcements_and_profiles.sql`, `202610260001_school_branding_and_portal_context.sql`, `202610260002_portal_workflows.sql`, then `202610260003_teacher_signup_requests.sql`.
4. Review the RLS rules, authentication configuration, membership roles, and Storage policies before using real data.
5. Restart Vite after changing `.env`.

**Never put a Supabase service-role key, M-Pesa secret, bank credential, or AI API key in a `VITE_` variable or browser code.** Keep those in Supabase Edge Function secrets.

## Important security boundary

Separate URLs and hidden cross-portal links improve privacy and usability, but they do not alone enforce security. Every backend query and database operation must check the authenticated user’s role, school membership, school status, and record ownership. The current UI checks a basic membership role after sign-in; it is still a development scaffold and has not been audited as a complete authorization system. Some roles may need a platform-level membership record rather than a school membership, so platform-admin bootstrap must be completed separately.

## What's included in this milestone

- Seven independent Vite/React app roots, individual ports, titles, login screens and role-specific navigation.
- Shared responsive portal UI and shared profile settings.
- Profile photo upload UI, local preview, Supabase Storage upload flow and SQL migration.
- Platform announcements saved in Supabase and shown in recipient portal inboxes. Delivery is in-app only; email, SMS and push are not configured.
- Platform-admin user directory with contact details, school roles and signed private profile photos.
- Existing initial Supabase schema and starter Edge Functions for admissions, teacher application review, Daraja STK Push/callback, AI draft generation and bank-provider boundary.
- `.env.example`, Windows setup guide, architecture/deployment notes and implementation checklist.

## What is not finished yet

This is **not a finished production system**. Real data CRUD, full account provisioning, parent application submission, complete role-by-role authorization, complete school onboarding/subscription controls, fee allocation/reconciliation/receipts, a selected bank integration, full academic/report-card workflows, notifications, and production tests remain to be implemented. The included payment and AI functions need sandbox tests and secret configuration. Do not use real student data or live payment credentials until the backend policies and workflows have been reviewed and tested.

## Deployment shape

Create seven hosting projects from the same repository and use the repository root as each build root (shared code lives outside `apps/`). For each project, set build command `npm run build --workspace apps/<portal>` and output directory `apps/<portal>/dist`; substitute the relevant portal folder. Configure DNS for your chosen domain. Example:

- `platform.yourdomain.com` → `apps/platform-admin`
- `school-admin.yourdomain.com` → `apps/school-admin`
- `principal.yourdomain.com` → `apps/principal`
- `secretary.yourdomain.com` → `apps/secretary`
- `teacher.yourdomain.com` → `apps/teacher`
- `student.yourdomain.com` → `apps/student`
- `parent.yourdomain.com` → `apps/parent`

These hostnames are examples only; you need a domain, hosting, DNS and production environment variables. Configure Supabase Auth redirect URLs and CORS/allowed origins for all deployed sites.
