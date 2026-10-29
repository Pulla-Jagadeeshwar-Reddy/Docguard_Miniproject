# Testing and verification

This status separates checks run during the Push implementation from integration scenarios that require the local databases.

## Phase 7 workspace checks

| Check | Result |
|---|---|
| `npm run build --workspace backend` | Passed on Phase 6 changes. TypeScript compiled. |
| `npm run lint --workspace frontend` | Passed on Phase 6 changes. Frontend TypeScript check completed. |
| `npm run build --workspace frontend` | Passed on Phase 7 changes. Next.js generated the Search, My Policies, acknowledgment, and coverage routes. |
| `git diff --check` | Passed; only Git's LF-to-CRLF notices were reported for new files. |
| `npm run test --workspace backend` | Not run. No `.env` or database target was present, and the Docker Desktop Linux engine was unavailable. |
| `npm run db:test` | Not run for the same Docker/database reason. |
| Browser screenshots | Not captured because the app could not be run against a database. See `SCREENSHOTS.md` for required states. |

The earlier Pull Phase 7 report recorded 5 Jest suites/10 tests passing before Push's Phase 2–6 features were added. That historical result does not verify the new Push flows.

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
| 1 | Wrong-password login is generic | `backend/test/auth.test.mjs` | Previously passed in Pull's Phase 7 run; not rerun here |
| 2 | SQL injection text in search | Parameterized PostgreSQL query; `search.test.mjs` sends SQL-shaped text | Added; not run here |
| 3 | Restricted role cannot find a policy it cannot read | `fn_accessible_document_ids` CTE; `search.test.mjs` checks Staff cannot see Patient Identification | Added; not run here; exact Nurse/Admin-only fixture remains absent |
| 4 | Upload identical file twice | Checksum uniqueness and `documents.test.mjs` | Previously passed; not rerun here |
| 5 | Uploader cannot approve own version | SQL CHECK and document API test | Previously passed; not rerun here |
| 6 | Expiry before effective date | SQL CHECK negative test | Previously passed; not rerun here |
| 7 | Approving a new version supersedes old and updates current pointer | Version trigger and document API test | Previously passed; not rerun here |
| 8 | Failure mid-upload removes Mongo data | Upload compensation and orphan sweeper are implemented | Forced-failure integration test still needed |
| 9 | Runtime role cannot update/delete audit rows | Immutable trigger and runtime grants | Previously passed; not rerun here |
| 10 | Superuser tampering is detected | `audit_tamper_demo.sql` and verifier | Previously passed; not rerun here |
| 11 | Short break-glass justification is rejected | SQL/API checks | Previously passed; not rerun here |
| 12 | Expired override grants no access | Access function negative test | Previously passed at SQL-function level; not rerun here |
| 13 | New approved version resets acknowledgment | Version-specific acknowledgment joins and notification trigger | Implemented; dedicated version-reset assertion still needed |
| 14 | Circular dependency analysis terminates | Recursive CTE and dashboard dependency test | Previously passed; not rerun here |
| 15 | Expired-only mapped policy remains a gap | `push_constraints.sql` rollback fixture | Added; not run here |
| 16 | Semantic query finds sharps policy | Local embeddings and semantic route; `search.test.mjs` | Added; requires seeded Mongo content/model and was not run here |

## Run the full database-backed checks

1. Copy `.env.example` to `.env`, set local-only credentials, and start Docker Desktop.
2. Run `docker compose up -d`, then `npm run db:apply`.
3. Run `npm run db:mongo:indexes`, `npm run db:mongo:seed`, and `npm run db:embeddings`.
4. Run `npm run test --workspace backend` and `npm run db:test`.
5. Capture the real UI states listed in `SCREENSHOTS.md` and update each result after observing it.

`npm run db:rebuild-test` drops application schema objects and replaces them. Use it only with a dedicated disposable project database.
