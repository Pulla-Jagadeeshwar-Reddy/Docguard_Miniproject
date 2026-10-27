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
5. Start the API and web app with `npm run dev`.
6. Open `http://localhost:3000/login`; check the API at `http://localhost:4000/health`.

The health endpoint returns HTTP 200 only when PostgreSQL and MongoDB both respond to a ping.

## Environment

All credentials and connection settings are read from `.env`. The committed `.env.example` contains placeholders for local setup; do not commit a populated `.env` file.

## Database setup

Start PostgreSQL and MongoDB with `docker compose up -d`; PostgreSQL is published on host port `5433` to avoid a native Windows PostgreSQL service on `5432`.

- `npm run db:apply` applies the numbered SQL files in filename order to an empty schema and configures the restricted runtime role from `PG_PASSWORD`.
- `npm run db:auth` applies only the runtime-role migration to an already-created Phase 1 database.
- `npm run db:rebuild` drops and recreates every object in the database's `public` schema, then reapplies migrations. Use only with the dedicated local project database; it preserves Docker volumes but removes their schema objects.
- `npm run db:test` runs the SQL tests against an already-migrated schema.
- `npm run db:rebuild-test` rebuilds the schema and runs the SQL tests.

Pull's current SQL slice provides 14 core tables, core views/functions/triggers and seed accounts. Push's eight search/compliance tables and their SQL files are separate work. The SQL runner will include those files once they are added.

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

Run the auth and user-management API integration tests with `npm run test --workspace backend`. They use seeded fake accounts and remove temporary test users.

## Troubleshooting

- If Compose reports a missing variable, copy `.env.example` to `.env` in the repository root.
- If a port is busy, stop the conflicting service or change its published port in Compose and the matching connection variable.
- Check database startup with `docker compose ps` and `docker compose logs postgres mongo`.

## Project status

Phase 2 Pull auth and user administration. See `docs/DECISIONS.md` for current assumptions and source notes.
