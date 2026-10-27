# Testing and Verification

This file distinguishes automated checks that passed in the current Phase 7 workspace from rubric scenarios that remain unverified or unimplemented. It does not claim that all 16 blueprint tests pass.

## Commands and latest observed results

| Command | Result |
|---|---|
| `npm run test --workspace backend` | **Passed:** 5 Jest suites, 10 tests. Runs Supertest against the configured local PostgreSQL and MongoDB services. |
| `npm run db:test` | **Partial / non-zero exit:** `audit_tamper_demo.sql` passed and reported tampering at the inserted test row; `core_constraints.sql` passed. `push_constraints.sql` then stopped because the current local database is missing the Push demo policy seed (`demo-infection-control` and `demo-patient-privacy`). |
| `npm run lint` | **Passed** on the Phase 7 branch; backend and frontend TypeScript checks completed. |
| `npm run build` | **Passed** on the Phase 7 branch; backend compiled and Next.js generated all current routes. The first sandboxed attempt hit a Windows EPERM writing `.next`; the rerun with workspace permissions passed. |

`npm run db:test` does not reset the database. The database test runner executes SQL test files in filename order. The Pull-owned tamper and core constraint files passed before the Push seed prerequisite stopped the combined command. No fresh-schema rebuild was run for this report.

### Audit tamper rehearsal

`database/postgres/tests/audit_tamper_demo.sql` is a standalone, rollback-safe rehearsal. It:

1. Confirms the audit chain starts intact.
2. Inserts a synthetic document and a normal access event so the database trigger computes its hashes.
3. Temporarily disables `trg_audit_immutable` as the Compose database administrator and changes the audit event's IP address.
4. Calls `verify_audit_chain()` and asserts that it identifies the inserted log id.
5. Rolls back the entire transaction, including the tampered row and trigger DDL state.

It ran successfully in this workspace; the observed first broken row was `log_id 108`. The SQL test runs only with the migration/Compose administrator. The API runtime role cannot update or delete audit rows.

## Backend integration tests

The passing Jest suite covers:

- Database health reporting, generic failed-login responses, session login/logout, user administration permissions, and hiding password hashes.
- Document upload, duplicate checksum rejection, permission-filtered document lists, file download, maker-checker approval, version superseding, audit log listing, and audit verification.
- Dashboard data response and permission restrictions.
- Dependency graph and impact traversal across a three-document cycle.
- Notification inbox authentication, user isolation, and read-state updates.
- Break-glass request, temporary access grant, flagged audit row, Admin notifications, Admin review, and access removal after review.

Some integration fixtures are intentionally retained because access logs are append-only and foreign keys prevent deleting referenced records. SQL negative-test fixtures run inside transactions and roll back.

## Blueprint test matrix (16 cases)

| # | Scenario | Evidence and status |
|---:|---|---|
| 1 | Wrong-password login is generic | **Passed.** `backend/test/auth.test.mjs`; compares unknown-user and wrong-password responses. |
| 2 | SQL injection string in search | **Not verified.** There is no automated injection test. Current keyword search escapes Mongo regex metacharacters and binds SQL values, but that is not a substitute for the rubric test. |
| 3 | Nurse cannot find Admin-only document in search | **Partially implemented, not verified.** The search SQL selects candidates through `fn_accessible_document_ids`; no search-specific nurse visibility test currently runs. The document-library visibility check is separate. |
| 4 | Upload identical file twice | **Passed.** `backend/test/documents.test.mjs` expects the second upload to return 409. |
| 5 | Uploader cannot approve own version | **Passed.** SQL CHECK negative test in `core_constraints.sql`; API test also confirms the uploader is denied. |
| 6 | Expiry date before effective date | **Passed.** `core_constraints.sql` expects a CHECK violation. |
| 7 | Approving version 2 supersedes version 1 and updates current pointer | **Passed.** `core_constraints.sql` and `backend/test/documents.test.mjs`. |
| 8 | Forced failure mid-upload compensates Mongo writes | **Not implemented / not tested.** `backend/src/services/ingest.ts` is still an explicit stub that writes nothing to MongoDB; its compensation function is a no-op. |
| 9 | Application cannot UPDATE or DELETE access logs | **Passed.** `core_constraints.sql` verifies trigger rejection and checks the runtime role grants. |
| 10 | Superuser tampering is detected and first broken id reported | **Passed.** `audit_tamper_demo.sql` and the tamper section of `core_constraints.sql`; the tamper rehearsal ran successfully. |
| 11 | Five-character break-glass justification is rejected | **Passed.** SQL CHECK negative test and API validation test. |
| 12 | Expired override no longer grants access | **Passed at SQL-function level.** `core_constraints.sql` checks `fn_accessible_document_ids` after expiry and runs `fn_expire_overrides`; a full HTTP read/search-after-expiry scenario is not separately tested. |
| 13 | New approved version makes assigned users pending again | **Not verified.** Push SQL tests require demo seed data and stop before their assertions in the current database. |
| 14 | Circular document references terminate during impact analysis | **Passed.** `backend/test/dashboard-dependencies.test.mjs` creates a three-node cycle and asserts graph/impact endpoints return. |
| 15 | Mandatory control backed only by an expired document appears as a gap | **Not verified.** The current Push SQL test fails at its seed prerequisite; it does not reach this rubric scenario in the observed run. |
| 16 | Semantic search finds needle-stick policy for “needle prick injury” | **Not implemented.** The current `/api/search` route accepts keyword mode only; the ingestion and embedding worker remain a stub. |

## Fresh database guidance

For a deliberate disposable local database, `npm run db:rebuild-test` drops the project's current application schema, applies migrations, and runs tests. It is destructive to data in that database; use it only when the local `docuguard` schema is safe to rebuild. The test run described above used `npm run db:test` and did not reset the schema.
