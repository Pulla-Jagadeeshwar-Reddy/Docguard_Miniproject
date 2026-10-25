# Decisions and assumptions

## Phase 0

- The supplied blueprint and rubric were read before implementation. The authoritative ER diagram and data dictionary arrived before coding and are preserved with the rubric and blueprint under `docs/inputs/`. The DOCX blueprint is retained alongside a Markdown conversion.
- The original supplied attachments remain untouched in the repository root. Their canonical copies in `docs/inputs/` are versioned, and the root originals are ignored to avoid duplicate tracked copies.
- Use the official MongoDB Node.js driver as requested, despite the blueprint allowing Mongoose.
- The SQL schema is the 21 relational entities in the ER diagram plus `DOCUMENT_CHUNKS`, which the blueprint explicitly describes as an additional vector/search table (22 total tables).
- Docker Compose requires credentials from `.env`; no working credentials are embedded in the Compose file.
- `/health` checks both PostgreSQL and MongoDB and returns 503 if either is unavailable. It does not expose connection errors.
- The frontend uses Next.js 16.4.3. The initial Next.js 15 dependency tree included a high-severity PostCSS advisory; upgrading to the official Next.js 16 release resolved the install audit with zero reported vulnerabilities.

## Environment limitation observed

- Docker is not installed or available on PATH in the current execution environment. Compose health and the database-backed endpoint cannot be verified here unless Docker becomes available.
