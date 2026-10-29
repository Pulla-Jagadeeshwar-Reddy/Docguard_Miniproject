# Testing and verification

Checks below were run on the integrated workspace on 2026-10-29. Database checks use uniquely named disposable databases and leave the configured project databases intact.

## Recorded results

| Check | Result |
|---|---|
| `npm run lint` | Passed for backend and frontend TypeScript. |
| `npm run build` | Passed. Backend compiled; Next.js production build generated all 15 app routes. The build was run with local process permissions because the restricted workspace hit Windows `EPERM` while creating `.next` files. |
| `npm run db:rebuild-test` | Passed end to end on temporary PostgreSQL and MongoDB databases: migrations applied, all 12 demo policies seeded, MongoDB indexes created, 11 approved versions embedded, local model check passed, API tests passed, SQL tests passed twice, and both temporary databases were dropped. |
| Backend Jest/Supertest | Passed: 8 suites, 17 tests. |
| PostgreSQL tests | Passed: core constraints/triggers, Push constraints, and audit tamper rehearsal. SQL tests roll back their fixtures. |
| Embedding check | Passed: 384 finite dimensions with norm 1.0000. |
| PDF demo files | 12 generated PDFs; each opened as a one-page PDF and rendered for visual inspection. |
| DOCX demo files | 12 valid Office Open XML packages with non-empty document text. Visual rendering was not completed because LibreOffice is unavailable; the computer-use session was stopped by the user, so no further Word automation was attempted. |
| Screenshots | Not captured. See `SCREENSHOTS.md`; no images are fabricated. |
| NPM vulnerability audit | Registry access was unavailable in this environment (`ENOTFOUND registry.npmjs.org`); the install reported five low-severity advisories. A current registry-backed audit remains unverified. |

## Test files

- `backend/test/auth.test.mjs`: health, generic login errors, sessions/logout, role-gated user administration, password-hash exclusion, and user create/update.
- `backend/test/documents.test.mjs`: upload allow-list, upload/access/download, duplicate rejection with Mongo compensation, maker-checker approval, version superseding/current pointer, and audit verification.
- `backend/test/dashboard-dependencies.test.mjs`: role-filtered dashboard and cycle-safe dependency impact/graph.
- `backend/test/notifications.test.mjs`: authenticated inbox, user isolation, and read state.
- `backend/test/overrides.test.mjs`: break-glass lifecycle and reviewer flow.
- `backend/test/search.test.mjs`: semantic and hybrid permission filtering, SQL-shaped input, similar-document route, and Admin-only Mongo aggregations. Jest mocks the Transformers pipeline because ONNX's native typed arrays cross Jest's VM realm; the real model is separately exercised by `model:check` and seeded embedding generation.
- `backend/test/acknowledgments.test.mjs`: role-scoped assignment, acknowledgment, and Admin completion data.
- `backend/test/coverage.test.mjs`: coverage view, authorization, and idempotent mapping.
- `database/postgres/tests/core_constraints.sql`: database rejection of invalid values, duplicate keys, invalid version transitions, self-approval, access rules, expired overrides, notifications, break-glass limits, audit immutability, and more.
- `database/postgres/tests/push_constraints.sql`: Push constraints, expired-only coverage gap, and version-specific acknowledgment reset. Runs within an explicit transaction and rolls back.
- `database/postgres/tests/audit_tamper_demo.sql`: superuser tampering is detected by chain verification; the rehearsal rolls back.

## Blueprint test matrix

| # | Scenario | Evidence | Result |
|---:|---|---|---|
| 1 | Wrong-password login is generic | `auth.test.mjs` | Passed |
| 2 | SQL-shaped search input is safe | `search.test.mjs`; parameterized SQL | Passed |
| 3 | Restricted user cannot find an inaccessible policy | `search.test.mjs`; permission-filtered SQL | Passed |
| 4 | Upload identical file twice | `documents.test.mjs`; checksum uniqueness | Passed; Mongo write compensation is asserted |
| 5 | Uploader cannot approve own version | `documents.test.mjs`; maker-checker database CHECK | Passed |
| 6 | Expiry date before effective date is rejected | `core_constraints.sql` | Passed |
| 7 | New approval supersedes old version and updates current pointer | `documents.test.mjs`, `core_constraints.sql` | Passed |
| 8 | Failure after Mongo write removes uncommitted Mongo content | Duplicate upload compensation assertion in `documents.test.mjs`; orphan sweeper is fallback | Passed for duplicate-check failure path; arbitrary infrastructure failure injection is not simulated |
| 9 | Runtime role cannot update/delete audit rows | `core_constraints.sql`, grants and immutable trigger | Passed |
| 10 | Superuser tampering is detected | `audit_tamper_demo.sql`, `verify_audit_chain()` | Passed |
| 11 | Short break-glass justification is rejected | `core_constraints.sql`, override API | Passed |
| 12 | Expired override grants no access | `core_constraints.sql` | Passed |
| 13 | New approved version resets acknowledgment | `push_constraints.sql`, `v_ack_compliance` | Passed |
| 14 | Circular dependency analysis terminates | `dashboard-dependencies.test.mjs` | Passed |
| 15 | Expired-only mapped policy remains a coverage gap | `push_constraints.sql`, `v_control_coverage` | Passed |
| 16 | Semantic query finds the sharps policy | `search.test.mjs`, seeded local embeddings/model check | Passed |

## Repeat the checks

1. Copy `.env.example` to `.env`, set local passwords, and start Compose with `docker compose up -d`.
2. Install packages with `npm install`.
3. Run `npm run lint`, `npm run build`, and `npm run db:rebuild-test`.

`db:rebuild-test` uses separate temporary databases. `db:rebuild` is different: it drops objects in the configured database schema and should only be used with disposable data. Screenshots listed in `SCREENSHOTS.md` still need to be captured from the running UI.
