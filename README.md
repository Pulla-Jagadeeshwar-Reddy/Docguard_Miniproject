# DocuGuard

Healthcare Policy & Compliance Intelligence Platform for the DBMS Level 3 project.

## Prerequisites

- Node.js 22 and npm
- Docker Desktop with Docker Compose
- Git

## Local setup

1. Copy `.env.example` to `.env` and change the local-only passwords and JWT secret.
2. Start the databases with `docker compose up -d`.
3. Install workspace packages with `npm install`.
4. Start the API and web app with `npm run dev`.
5. Open `http://localhost:3000`; check the API at `http://localhost:4000/health`.

The health endpoint returns HTTP 200 only when PostgreSQL and MongoDB both respond to a ping. The database schema and demo users are added in later project phases.

## Environment

All credentials and connection settings are read from `.env`. The committed `.env.example` contains placeholders for local setup; do not commit a populated `.env` file.

## Database setup

Database migrations, seed instructions, and demo accounts will be documented after the SQL and demo-data phases. No demo accounts exist in the setup scaffold.

## Troubleshooting

- If Compose reports a missing variable, copy `.env.example` to `.env` in the repository root.
- If a port is busy, stop the conflicting service or change its published port in Compose and the matching connection variable.
- Check database startup with `docker compose ps` and `docker compose logs postgres mongo`.

## Project status

Phase 0 setup scaffold. See `docs/DECISIONS.md` for current assumptions and source notes.
