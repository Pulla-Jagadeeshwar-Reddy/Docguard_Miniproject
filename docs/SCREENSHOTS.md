# Screenshot Capture List

No screenshots are fabricated or included here. Capture these Pull-owned states from the running app and attach them to the final project documentation.

| # | Page | State to capture |
|---:|---|---|
| 1 | `/login` | Sign-in form with no credentials entered. |
| 2 | `/dashboard` | Status cards, expiring-soon rows, and access-activity chart with demo data. |
| 3 | `/documents` | Policy library as an Admin and as a restricted role, showing only permitted rows. |
| 4 | `/documents/new` | Upload form with file, category, effective date, and expiry fields. |
| 5 | `/documents/[id]` | Version history with pending version and Admin approval control. |
| 6 | `/admin/audit` | Audit filters and an intact verification result with check history. |
| 7 | `/documents/[id]/impact` | Dependency graph and impact list for a policy with linked dependents. |
| 8 | `/break-glass` | Emergency request dialog with the required justification field and duration selector. |
| 9 | `/admin/break-glass` | Pending request with justification and Admin review actions. |
| 10 | `/dashboard` or `/documents` | Notification bell open with unread count and a related policy notice. |

Push should append its own search, acknowledgment, and coverage page states after those features are implemented and verified.

## Push pages

| # | Page | State to capture |
|---:|---|---|
| 11 | `/search` | Hybrid query, category filter, result snippet, and mode labels for an approved synthetic policy. |
| 12 | `/documents/[id]` | Related-policies panel with similarity scores. |
| 13 | `/dashboard` | Admin keyword analytics widget populated from MongoDB policy content. |
| 14 | `/my-policies` | A pending assigned current version with the acknowledgment action. |
| 15 | `/admin/acknowledgments` | Assignment form and department completion chart with seeded data. |
| 16 | `/compliance/coverage` | Regulation score cards, a mandatory gap row, and the coverage matrix. |
