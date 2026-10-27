# Decisions and assumptions

## Phase 0

- The supplied blueprint and rubric were read before implementation. The authoritative ER diagram and data dictionary arrived before coding and are preserved with the rubric and blueprint under `docs/inputs/`. The DOCX blueprint is retained alongside a Markdown conversion.
- The original supplied attachments remain untouched in the repository root. Their canonical copies in `docs/inputs/` are versioned, and the root originals are ignored to avoid duplicate tracked copies.
- Use the official MongoDB Node.js driver as requested, despite the blueprint allowing Mongoose.
- The SQL schema is the 21 relational entities in the ER diagram plus `DOCUMENT_CHUNKS`, which the blueprint explicitly describes as an additional vector/search table (22 total tables).
- Docker Compose requires credentials from `.env`; no working credentials are embedded in the Compose file.
- `/health` checks both PostgreSQL and MongoDB and returns 503 if either is unavailable. It does not expose connection errors.
- The frontend uses Next.js 16.4.3. The initial Next.js 15 dependency tree included a high-severity PostCSS advisory; upgrading to the official Next.js 16 release resolved the install audit with zero reported vulnerabilities.
- The host-side PostgreSQL port is 5433 while the container still listens on 5432. The user machine has a native PostgreSQL service on IPv4 port 5432, which intercepted backend connections; the separate port makes host routing unambiguous.
- Pull/Push contracts from `docs/WORK_SPLIT.md` are the provisional implementation interface: `req.user` has `id`, `roleId`, `role`, and `departmentId`; `fn_accessible_document_ids(user_id)` centralizes role-grant and active-override access; Pull exposes `logAccess(client, { userId, documentId, versionId, action, ip })`; Push ingestion exposes `ingestFile`, `deleteIngested`, and `queueEmbedding`; Push adds acknowledgment notifications directly in its trigger. Confirm these at the team sync before wiring cross-slice routes.
- The schema creates `docuguard_runtime` as a non-login role and grants only append/read access on `access_logs`. Phase 2 must enable login for this role and configure the app connection; migrations continue using the separate Compose administrator.
- `dependency_warning` is an additive notification type so the Pull-owned document-retirement trigger can notify owners of dependent policies. The original dictionary's notification CHECK list did not include this type.

## Phase 2

- The backend connects as `docuguard_runtime`, not the Compose administrator. Migration 08 enables this role using the `PG_PASSWORD` value supplied through the migration runner; DDL continues to run as `POSTGRES_USER`.
- Role and permission assignments are loaded from PostgreSQL on every authenticated request instead of trusting JWT role claims. Account suspension and role changes therefore take effect on the next request.
- Sessions use an HTTP-only, SameSite=Lax cookie; the JWT contains only the user id. Secure cookies are enabled in production. JWT lifetime is configurable from one second to one day.
- Phase 2 uses Jest with Supertest for API integration coverage. Tests import the compiled TypeScript backend, so the project does not need a second TypeScript test compiler. Login generic-error and user-access cases are covered; blueprint search-injection test 2 is deferred until Push adds the search endpoint.
- GET `/api/users` returns role and department options along with user rows so the admin form uses actual database ids rather than assuming seed ids.
