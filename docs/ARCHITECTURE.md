# Architecture: seven sites, one secured platform

```text
platform.yourdomain.com       school-admin.yourdomain.com
principal.yourdomain.com      secretary.yourdomain.com
teacher.yourdomain.com        student.yourdomain.com
parent.yourdomain.com
          | each is an independent deployed frontend
          v
Shared Supabase Auth + PostgreSQL + private Storage + Edge Functions
          |
          v
School-scoped data and backend-enforced role/tenant policies
```

## Privacy requirements
- Do not add links to other portals inside a role's navigation or login page.
- Each site should have its own deployment/hostname, branded login page and role-specific navigation.
- Use the same identity provider only with backend membership checks; knowing another portal URL must never grant access.
- Each school-owned table must be protected by reviewed Row Level Security and verified `school_id` membership.
- Platform-admin permissions should be narrowly scoped to platform operations; they should not automatically grant editing rights to academic or financial records.
- Suspension must be checked server-side for write operations and should preserve existing data.
- Keep profile photos in private storage. A profile can store a path, not a public permanent URL. Generate short-lived signed URLs only after access checks.

## Profile photo upload
The shared profile component validates image MIME type and size in the browser. The SQL migration creates a private bucket limited to JPEG/PNG/WebP and 3 MB, and policies restrict each user's storage path to their own UUID folder. Production policy review should decide which authorized school users may view other people's profile photos and implement that explicitly.

## Local development ports
5173 platform admin, 5174 school admin, 5175 principal, 5176 secretary, 5177 teacher, 5178 student, 5179 parent. Ports are only for local development; deployed hostnames must be configured at the hosting/DNS provider.
