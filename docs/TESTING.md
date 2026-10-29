# Testing and verification

This status records checks against the integrated `main` code and separates them from scenarios that require reachable databases.

## Integrated `main` workspace checks (2026-10-29)

| Check | Result |
|---|---|
| `npm run lint` | Passed for backend and frontend TypeScript. |
| `npm run build` | Backend TypeScript build passed. Frontend Next.js production build passed and generated all listed routes. The frontend build needed to run outside the restricted sandbox because its worker process could not start inside it. |
| `npm run test --workspace backend` | Attempted. With local socket access, all 8 suites / 17 tests failed at database-dependent setup: `/health` returned 503, PostgreSQL at the configured `localhost:5433` refused connections, and login requests returned 500. This does not verify feature behavior. The restricted attempt separately failed because test-server sockets were denied. |
| `npm run db:test` | Not run: Docker engine access is denied in this workspace and the database services are not reachable here. |
| Browser screenshots | Not captured because the app could not be run against reachable databases. See `SCREENSHOTS.md` for required states. |

Historical Pull Phase 7 results predate the merged Push flows and do not verify the integrated feature set.

## Test coverage in the repository

- `backend/test/auth.test.mjs`: generic login errors, sessions, user authorization, and password-hash exclusion.
- `backend/test/documents.test.mjs`: duplicate upload, permission-filtered documents, downloads, approval, versioning, and audit.
- `backend/test/dashboard-dependencies.test.mjs`: dashboard access and cycle-safe dependency traversal.
- `backend/test/notifications.test.mjs`: notification user isolation and read-state updates.
- `backend/test/overrides.test.mjs`: break-glass lifecycle and review.
- `backend/test/search.test.mjs`: semantic retrieval, injected query text, role-filtered search, similar-policy access, and Admin analytics authorization.
- `backend/test/acknowledgments.test.mjs`: assignment target validation, Nurse visibility/acknowledgment, and Admin completion data.
- `backend/test/coverage.test.mjs`: Admin authorization, coverage view results, and idempotent policy mapping.
- `database/postgres/tests/core_constraints.sql`: core database constraints, audit immutability, permissions, and version rules.
- `database/postgres/tests/push_constraints.sql`: Push schema constraints, coverage scores, and expired-only mandatory-control gap behavior. Test files run in a transaction and roll back.
- `database/postgres/tests/audit_tamper_demo.sql`: rollback-safe superuser tamper rehearsal.

## Blueprint test matrix

| # | Scenario | Implementation/evidence | Current status |
|---:|---|---|---|
| 1 | Wrong-password login is generic | `backend/test/auth.test.mjs` | Not verified on integrated `main`; current Jest run cannot reach the database |
| 2 | SQL injection text in search | Parameterized PostgreSQL query; `search.test.mjs` sends SQL-shaped text | Added; not run here |
| 3 | Restricted role cannot find a policy it cannot read | `fn_accessible_document_ids` CTE; `search.test.mjs` checks Staff cannot see Patient Identification | Added; not run here; exact Nurse/Admin-only fixture remains absent |
| 4 | Upload identical file twice | Checksum uniqueness and `documents.test.mjs` | Not verified on integrated `main`; database suite blocked |
| 5 | Uploader cannot approve own version | SQL CHECK and document API test | Not verified on integrated `main`; database suite blocked |
| 6 | Expiry before effective date | SQL CHECK negative test | Not verified on integrated `main`; SQL suite not run |
| 7 | Approving a new version supersedes old and updates current pointer | Version trigger and document API test | Not verified on integrated `main`; database suite blocked |
| 8 | Failure mid-upload removes Mongo data | Upload compensation and orphan sweeper are implemented | Forced-failure integration test still needed |
| 9 | Runtime role cannot update/delete audit rows | Immutable trigger and runtime grants | Not verified on integrated `main`; SQL suite not run |
| 10 | Superuser tampering is detected | `audit_tamper_demo.sql` and verifier | Not verified on integrated `main`; SQL suite not run |
| 11 | Short break-glass justification is rejected | SQL/API checks | Not verified on integrated `main`; database suite blocked |
| 12 | Expired override grants no access | Access function negative test | Not verified on integrated `main`; SQL suite not run |
| 13 | New approved version resets acknowledgment | Version-specific acknowledgment joins and notification trigger | Implemented; dedicated version-reset assertion still needed |
| 14 | Circular dependency analysis terminates | Recursive CTE and dashboard dependency test | Not verified on integrated `main`; database suite blocked |
| 15 | Expired-only mapped policy remains a gap | `push_constraints.sql` rollback fixture | Added; not run here |
| 16 | Semantic query finds sharps policy | Local embeddings and semantic route; `search.test.mjs` | Added; requires seeded Mongo content/model and was not run here |

## Run the full database-backed checks on the machine hosting the services

1. Ensure `.env` points at reachable PostgreSQL and MongoDB services. For a database running on the same machine, use the Compose host ports from `.env.example`; for a database on another machine, use that machine's reachable address and exposed ports.
2. Start/confirm the services, then run `npm run db:apply` only against the project's intended database. Do not use a rebuild command on a shared or valuable database.
3. Run `npm run db:mongo:indexes`, `npm run db:mongo:seed`, and `npm run db:embeddings`.
4. Run `npm run test --workspace backend` and `npm run db:test`.
5. Capture the real UI states listed in `SCREENSHOTS.md` and update each result after observing it.

`npm run db:rebuild-test` drops application schema objects and replaces them. Use it only with a dedicated disposable project database.
