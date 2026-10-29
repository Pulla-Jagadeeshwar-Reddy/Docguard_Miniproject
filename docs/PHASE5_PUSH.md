# Push — Phase 5 policy acknowledgments

## API

- Admins assign an active policy with a current, approved, unexpired version to exactly one role or department via `POST /api/assignments`.
- `GET /api/assignments` returns assignment-level completion. `GET /api/compliance/acknowledgments` returns the relational compliance and department views for Admins.
- `GET /api/acknowledgments/mine` returns only assignments matching the authenticated user's current role and department, and compares acknowledgment records to the current policy version.
- `POST /api/acknowledgments` inserts the user's acknowledgment for the assignment's current version. Repeated submission is idempotent; a new approved version creates a new pending acknowledgment automatically through the existing trigger.
- Assignment triggers create the `ack_required` notifications for eligible active users.

## UI

- `/my-policies` shows assigned current versions, due dates, overdue state, and an acknowledgment action.
- `/admin/acknowledgments` provides role/department assignment, per-assignment completion, and a department completion chart.
- Admin dashboard includes a combined acknowledgment completion summary.

## Verification

Backend TypeScript and frontend TypeScript checks pass. `backend/test/acknowledgments.test.mjs` covers target validation, Nurse assignment visibility, acknowledgment submission, and the Admin completion endpoint against seeded database rows.
