# Team Ownership

The implementation is divided into vertical feature slices so both students contribute to the database and application layers. Use the names **Pull** and **Push** in the demo and contribution history.

## Pull

- PostgreSQL core schema, constraints, triggers, views, indexes, seed, runtime role, and migration runner.
- Authentication, RBAC, and user administration.
- Document upload/version/approval workflows, access checks, and audit hash chain.
- Expiry sweeper and notifications.
- Dashboard status/expiry/activity widgets and document dependency graph/impact.
- Break-glass request transaction and Admin review.
- `ARCHITECTURE.md`, `RELATIONAL_SCHEMA.md`, `TESTING.md`, audit tamper rehearsal, and Pull-side demo/screenshot notes.

## Push

- MongoDB schemas, content ingestion, extraction, chunking, embeddings, and search/similarity services.
- Search, acknowledgment, regulatory coverage, and analytics database tables/views and application pages.
- Synthetic policy/regulation seed content, `QUERIES.md`, `NOSQL_VECTOR.md`, `RUBRIC_CHECKLIST.md`, screenshots, and README polish.

## Joint responsibilities

- Review and explain each other's database and application code.
- Rehearse the complete demo, confirm the final rubric evidence, and merge only after both students run the app and checks.
- Maintain `DECISIONS.md`, `DEMO_GUIDE.md`, and the combined screenshot inventory as the project evolves.

Ownership identifies the agreed work split; it does not claim that a feature is complete. See [`TESTING.md`](TESTING.md) for current implementation and verification status.
