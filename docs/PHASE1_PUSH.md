# Push — Phase 1 implementation

This file is the Phase 1 scope snapshot for Push's database deliverables: schema, seed data, MongoDB setup/analytics, and SQL constraint tests. The Phase 2 and later sections below it were completed in subsequent phase branches.

## Files added

- `database/postgres/01b_schema_search.sql` — eight Push-owned tables and pgvector extension.
- `database/postgres/03b_indexes_search.sql` — vector HNSW, full-text GIN, and relational indexes.
- `database/postgres/04b_functions_search.sql` — regulatory coverage score function.
- `database/postgres/05b_triggers_search.sql` — acknowledgment reminders on assignment and newly approved versions.
- `database/postgres/06b_views_search.sql` — acknowledgment compliance and regulatory coverage views.
- `database/postgres/07b_seed_search.sql` — illustrative regulations, controls, three synthetic policy rows, role permissions, and assignments.
- `database/postgres/tests/push_constraints.sql` — negative tests and coverage sanity checks.
- `database/mongo/indexes.js` — required MongoDB indexes.
- `database/mongo/seed.js` — seeds the policy Markdown into MongoDB and links it to seeded PostgreSQL IDs.
- `database/mongo/aggregations.js` — reusable top-keyword, category-statistics, longest-document and `$facet` pipelines.
- `docs/demo-policies/*.md` — fictional policies for development/demo only.

## Run order on Windows

1. Copy `.env.example` to `.env` and set local passwords. Keep `.env` out of Git.
2. Start Docker Desktop, then run `docker compose up -d` from the repository root.
3. Run `npm install` if dependencies are not installed.
4. Apply all SQL migrations: `npm run db:apply`.
5. Create MongoDB indexes: `npm run db:mongo:indexes`.
6. Seed the synthetic policy text into MongoDB: `npm run db:mongo:seed`.
7. Run SQL checks: `npm run db:test`.
8. Inspect MongoDB aggregations: `npm run db:mongo:analytics`.

Run SQL migrations before MongoDB seeding because the seed script reads generated document/version IDs from PostgreSQL. The SQL seed creates the matching documents and versions.

## What Phase 1 did not do at that phase boundary

- It does not generate embeddings or insert rows into `document_chunks`; that table receives vectors when the local embedding worker is implemented in Phase 2.
- It does not expose search, acknowledgment or compliance HTTP endpoints yet.
- The synthetic regulation/control mappings are for demonstrating database behavior, not legal or accreditation advice.
- The MongoDB seeder expects the three SQL demo versions to exist. It fails loudly if they do not.

## Validation note

The SQL scripts are integrated into the existing numbered migration runner by filename order. Run the migration and tests locally against the project Docker databases before merging; do not run `npm run db:rebuild` against any database containing data you need, because it drops and recreates the `public` schema.
