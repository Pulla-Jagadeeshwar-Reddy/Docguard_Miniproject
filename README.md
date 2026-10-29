# DocuGuard

Healthcare Policy & Compliance Intelligence Platform for the DBMS Level 3 project.

## Prerequisites

- Node.js 22 and npm
- Docker Desktop with Docker Compose
- Git

## Local setup

1. Copy `.env.example` to `.env` and change the local-only passwords and JWT secret. Keep `POSTGRES_USER` as the migration/Compose administrator; `PG_USER` should remain `docuguard_runtime` for the API.
2. Start the databases with `docker compose up -d`.
3. Install workspace packages with `npm install`.
4. Apply the schema with `npm run db:apply`.
5. Seed MongoDB's indexes and synthetic policy text: `npm run db:mongo:indexes` followed by `npm run db:mongo:seed`.
6. Generate embeddings for those seed policies with `npm run db:embeddings` (first run downloads and caches the model).
7. Optionally verify the local embedding model with `npm run model:check`.
8. Start the API and web app with `npm run dev`.
9. Open `http://localhost:3000/login`; check the API at `http://localhost:4000/health`.

The health endpoint returns HTTP 200 only when PostgreSQL and MongoDB both respond to a ping.

## Environment

All credentials and connection settings are read from `.env`. The committed `.env.example` contains placeholders for local setup; do not commit a populated `.env` file.

## Database setup

Start PostgreSQL and MongoDB with `docker compose up -d`; PostgreSQL is published on host port `5433` to avoid a native Windows PostgreSQL service on `5432`.

- `npm run db:apply` applies the numbered SQL files in filename order to an empty schema and configures the restricted runtime role from `PG_PASSWORD`.
- `npm run db:auth` applies only the runtime-role migration to an already-created Phase 1 database.
- `npm run db:documents` applies the document checksum migration to an existing Phase 2 database.
- `npm run db:rebuild` drops and recreates every object in the database's `public` schema, then reapplies migrations. Use only with the dedicated local project database; it preserves Docker volumes but removes their schema objects.
- `npm run db:test` runs the SQL tests against an already-migrated schema.
- `npm run db:rebuild-test` creates uniquely named temporary PostgreSQL and MongoDB databases, applies migrations and seeds, runs model, API, and SQL tests, then removes those temporary databases. It leaves the configured project databases untouched.
- `npm run model:check` verifies that the configured local embedding model returns 384 finite, normalized values.
- `npm run db:mongo:indexes` creates or upgrades MongoDB indexes; `npm run db:mongo:seed` loads the synthetic policy text after SQL migrations; `npm run db:embeddings` indexes approved seed versions for semantic search.

The integrated SQL schema includes the core document, access, and audit tables plus search, acknowledgment, and regulatory coverage tables. Numbered migrations apply both contributors' schema slices in order.

Seeded fake demo accounts (passwords are stored as salted bcrypt hashes at cost 12):

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin1@docuguard.local` | `DG-Demo-Admin-01!` |
| Admin | `admin2@docuguard.local` | `DG-Demo-Admin-02!` |
| Doctor | `doctor1@docuguard.local` | `DG-Demo-Doctor-01!` |
| Doctor | `doctor2@docuguard.local` | `DG-Demo-Doctor-02!` |
| Nurse | `nurse1@docuguard.local` | `DG-Demo-Nurse-01!` |
| Nurse | `nurse2@docuguard.local` | `DG-Demo-Nurse-02!` |
| Staff | `staff1@docuguard.local` | `DG-Demo-Staff-01!` |
| Staff | `staff2@docuguard.local` | `DG-Demo-Staff-02!` |

These credentials are for the synthetic local demo only. PostgreSQL migrations run as the Compose administrator (`POSTGRES_USER`); the API connects as the restricted `docuguard_runtime` role (`PG_USER`) using `PG_PASSWORD`. Keep those settings distinct in `.env`.

## Run the app

After the databases are healthy and `npm run db:apply` has completed, start the API and web app with `npm run dev`. Sign in at `http://localhost:3000/login`. The API sets an HTTP-only session cookie; passwords and password hashes are never returned. Admins can manage accounts from the User administration page.

Run API integration tests with `npm run test --workspace backend` after both databases are healthy and migrations/seeds are applied. The document workflow test intentionally leaves one synthetic policy and append-only audit events in the database. `npm run db:rebuild-test` uses separate disposable databases; `npm run db:rebuild` still resets the configured database schema and should only be used for disposable project data.

Uploaded PDF and DOCX files are extracted into MongoDB and divided into overlapping text chunks. The local `Xenova/all-MiniLM-L6-v2` model generates 384-dimensional vectors for PostgreSQL; the model is downloaded and cached the first time an upload or approval runs. See [`docs/PHASE2_PUSH.md`](docs/PHASE2_PUSH.md) for runtime details and OCR limitations.

## Troubleshooting

- If Compose reports a missing variable, copy `.env.example` to `.env` in the repository root.
- If a port is busy, stop the conflicting service or change its published port in Compose and the matching connection variable.
- Check database startup with `docker compose ps` and `docker compose logs postgres mongo`.

## Project documentation

- [`docs/QUERIES.md`](docs/QUERIES.md) — important SQL and MongoDB queries.
- [`docs/NOSQL_VECTOR.md`](docs/NOSQL_VECTOR.md) — MongoDB collections, vector search, and hybrid ranking.
- [`docs/RUBRIC_CHECKLIST.md`](docs/RUBRIC_CHECKLIST.md) — rubric evidence and demo order.
- [`docs/TESTING.md`](docs/TESTING.md) — verification status and the full test matrix.
- [`docs/DEMO_GUIDE.md`](docs/DEMO_GUIDE.md) — Pull and Push demo walkthrough.
- [`docs/PHASE7_PUSH.md`](docs/PHASE7_PUSH.md) — Push finish record and outstanding local verification.

## Project status

Pull and Push feature slices are integrated on `main`. The current workspace has passed TypeScript linting, database-backed API tests, SQL constraint and audit-tamper tests, and the local embedding check against disposable databases. The PDF samples were rendered and inspected; DOCX packages were structurally checked, but could not be visually rendered because LibreOffice is unavailable. No screenshots were fabricated. See [`docs/TESTING.md`](docs/TESTING.md) for the exact verification record.
