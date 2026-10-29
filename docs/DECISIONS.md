# Decisions and assumptions

## Phase 0

- The supplied blueprint and rubric were read before implementation. The authoritative ER diagram and data dictionary arrived before coding and are preserved with the rubric and blueprint under `docs/inputs/`. The DOCX blueprint is retained alongside a Markdown conversion.
- The original supplied attachments remain untouched in the repository root. Their canonical copies in `docs/inputs/` are versioned, and the root originals are ignored to avoid duplicate tracked copies.
- Use the official MongoDB Node.js driver as requested, despite the blueprint allowing Mongoose.
- The SQL schema is interpreted as 21 non-vector business tables plus `DOCUMENT_CHUNKS` (22 total). The ER diagram also draws `DOCUMENT_CHUNKS`, so it visually lists all 22 tables; the data dictionary and DDL are the column-level sources of truth.
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
- Push extraction uses PDF.js for PDF text and Mammoth for DOCX text. Scanned-image OCR remains out of scope.
- Push stores 300-word chunks with a 50-word overlap in MongoDB. The local `Xenova/all-MiniLM-L6-v2` Transformers.js feature-extraction pipeline creates normalized 384-dimensional vectors; PostgreSQL stores vectors and English `tsvector` values together.
- Mongo content is prepared before the SQL upload transaction, linked to generated SQL ids before commit, and deleted as compensation on failure. A delayed orphan sweep removes old Mongo records that have no SQL version.
- Mongo version uniqueness indexes filter for linked numeric version ids, allowing multiple concurrent in-flight ingestion records with `versionId: null`.

## Phase 3

- Push's MongoDB extraction/embedding service is not present on this branch yet. `backend/src/services/ingest.ts` is the explicitly temporary work-split stub: it returns clearly labeled synthetic Mongo references and no chunks, and compensation/embedding queue methods are no-ops until Push replaces them. The UI marks document text extraction/search indexing as pending. Re-upload policies after Push's ingestion service is integrated so real Mongo content and chunks are created.
- The API still calls the ingestion compensation interface and removes its local file on a failed PostgreSQL transaction. The forced mid-upload Mongo compensation test (blueprint test 8) cannot be meaningfully exercised until Push's real Mongo ingestion implementation is available; no test claims that stub writes or deletes MongoDB content.
- Uploads are persisted under the configured `UPLOAD_DIR` outside Next.js's public directory, using random server filenames; PostgreSQL stores only that opaque file name. A secure version download endpoint checks `fn_accessible_document_ids` and writes an access-log event before streaming.
- Added a unique PostgreSQL checksum index beyond the data dictionary's stated constraints. The blueprint requires identical-file rejection, and the unique index closes the concurrent-upload race that an API-only check cannot prevent.
- New uploads grant read permission to Admin reviewers and the uploader's role so pending drafts can be reviewed and are visible in the role-filtered policy library. Fine-grained grants for other roles remain managed by database permission rows until a permission-management UI is in scope.
- Audit verification takes the same transaction advisory lock as the access-log hash trigger, rather than a table write lock, so verification sees a stable chain while the restricted API role remains unable to update or delete logs.
- The document integration test uses one fixed synthetic PDF fixture and leaves its records and access events in the demo database. This keeps tests repeatable and respects the audit table's insert-only rule; `npm run db:rebuild-test` resets the local demo schema when a clean state is needed.
- Tailwind CSS is configured through PostCSS. The frontend production build uses Next.js webpack because the default Turbopack CSS worker exited in this Windows environment; the webpack build compiled and generated all routes successfully.

## Phase 4

- The existing PostgreSQL expiry functions remain the source of truth for expiration and warning creation. The API invokes them at startup and every 24 hours; a transaction-scoped advisory lock prevents concurrent API instances from running the sweep simultaneously.
- Notification reads and updates are scoped by the authenticated user id in SQL. The shared bell shows the latest ten rows and polls once per minute; the database notification table remains the durable inbox.

## Phase 5

- The supplied work split assigns the dependency graph to Pull, while the older blueprint section 18 lists it under Member B. The user's explicit instruction to complete Pull's work-split assignments takes precedence; Push-owned search, acknowledgments, and regulatory pages remain out of this branch.
- Dependency graph reads, impact analysis, and reference writes are Admin-only as specified by the blueprint API table. Graph traversal treats links as connected relationships and uses a visited-id path; impact follows reverse dependency direction so it lists policies that depend on the selected policy.
- Dashboard policy counts use the shared status view. Expiring policy rows are filtered with `fn_accessible_document_ids`; Admins see the shared activity view while other roles see only their own access events.

## Phase 6

- Emergency access requests are limited to Doctor and Nurse roles. The requester enters a policy id instead of receiving a catalog of restricted policy titles; only an active policy with an approved, unexpired current version is eligible.
- The request transaction writes the temporary grant, flagged audit row, and one review notification per active Admin. Review records the outcome and moves the override to `reviewed`, which removes its grant from `fn_accessible_document_ids`.
- Break-glass integration tests retain their synthetic policy, override, notifications, and append-only audit row as audit evidence; tests must not delete those records.

## Phase 7

- The standalone audit tamper rehearsal and core SQL constraint suite run in transactions and roll back their synthetic rows and trigger changes. No database rebuild was used for documentation verification, to preserve the local project database.
- The original Phase 7 status snapshot predates Push Phases 2–7. Current completion and verification status is maintained in `docs/TESTING.md`.
