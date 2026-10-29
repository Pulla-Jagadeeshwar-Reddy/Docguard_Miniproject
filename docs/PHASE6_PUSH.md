# Push — Phase 6 regulatory coverage

## API

- Admin-only routes manage regulations, controls, and document-control mappings through `/api/regulations`, `/api/controls`, and `/api/control-map`.
- `GET /api/compliance/coverage` returns regulation scores and control-level status from `v_regulatory_coverage_summary` and `v_control_coverage`.
- A control is covered only when at least one mapped policy has an active document and a current approved, unexpired version. Mandatory coverage percentages use `fn_control_coverage_score` and exclude optional controls.
- Duplicate document-control mapping submissions are idempotent.

## UI

- `/compliance/coverage` provides regulation score cards, a filterable coverage matrix, mandatory gap list, and Admin forms to add regulations, controls, and policy mappings.
- The Admin dashboard now includes an overall mandatory-control coverage summary alongside acknowledgment and keyword analytics.
- Supplied regulation and control names are labeled as illustrative educational data, not official interpretations.

## Verification

Backend and frontend TypeScript checks pass. `backend/test/coverage.test.mjs` checks Admin authorization, seeded coverage results, and idempotent mapping. `database/postgres/tests/push_constraints.sql` adds a rollback-safe scenario proving an expired-only mandatory mapping stays a gap.
