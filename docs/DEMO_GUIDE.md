# Pull Demo Segment

This is Pull's part of the joint demo, following the order in `docs/WORK_SPLIT.md`. It covers the database design, authentication, document workflow, dashboard/graph, audit chain, and break-glass flow. Push should add its own verified search, acknowledgment, coverage, and analytics segment before the team calls this a complete 20-minute project script.

## Setup before presenting

- Follow the root README to start Docker, apply migrations, and start the app.
- Keep the API and frontend terminals visible for errors.
- Use the synthetic demo accounts in README only.
- Confirm an Admin and Nurse account can sign in. Have two distinct Admins available for maker-checker.
- Prepare one synthetic PDF or DOCX to upload. Do not upload real patient information.
- Use a dedicated demo database. The audit rehearsal and test workflows can create append-only audit events.

## Pull sequence (about 10 minutes)

### 1. Architecture and relational model (2 minutes)

1. Open `docs/ARCHITECTURE.md` and trace browser → Next.js → Express → PostgreSQL/MongoDB.
2. Open the ER diagram in `docs/inputs/docuguard_er_diagram.mermaid` and the constraints in `docs/inputs/docuguard_data_dictionary.md`.
3. Explain the document/version circular foreign key and point to `database/postgres/02_alter.sql`.
4. Show the core migration list in `docs/RELATIONAL_SCHEMA.md`.

### 2. Login, roles, and document workflow (3 minutes)

1. Open `http://localhost:3000/login` and sign in as `admin1@docuguard.local`.
2. Open **Documents → Upload** and submit the prepared synthetic policy with an effective date and optional expiry.
3. Open the new policy detail and show its pending version.
4. Sign out and sign in as `admin2@docuguard.local`; open the same policy and approve the pending version.
5. Return to the policy detail and show the approved current version and version history. Explain that the uploader cannot approve their own version.

### 3. Dashboard and dependency impact (1.5 minutes)

1. Open **Overview** and point out status counts, the permission-filtered expiry list, and access activity chart.
2. Open a document detail and choose **View dependency graph and impact** as Admin.
3. Show the graph and affected-policy list. Explain the recursive CTE path array prevents cycles from recursing forever.

### 4. Audit chain (2 minutes)

1. Open **Audit log** and click **Verify integrity**; show the intact result and verification history.
2. For the controlled tamper demonstration, run the dedicated SQL script from PowerShell:

   ```powershell
   docker compose cp database/postgres/tests/audit_tamper_demo.sql postgres:/tmp/audit_tamper_demo.sql
   docker compose exec -T postgres psql -U docuguard_app -d docuguard -v ON_ERROR_STOP=1 -f /tmp/audit_tamper_demo.sql
   ```

   If `.env` uses another `POSTGRES_USER` or `POSTGRES_DB`, substitute those values. The script runs in one transaction and rolls back its fixture, trigger state, and tampering after showing the first broken log id.
3. Click **Verify integrity** again and explain why the SQL rehearsal rolls back instead of leaving a broken chain in the demo database.

### 5. Break-glass access (1.5 minutes)

1. Sign in as `nurse1@docuguard.local` and open **Emergency access**.
2. Enter a policy id supplied by the demo operator, choose a duration, and try submitting a short justification to show the form's minimum requirement.
3. Submit a valid synthetic justification. Explain that one PostgreSQL transaction writes the override, flagged audit event, and Admin notifications.
4. Sign in as `admin2@docuguard.local`, open **Emergency reviews**, and mark the request justified or unjustified. The review is recorded and closes the temporary grant.

## SQL evidence to show live

Use the Compose migration/admin account in `psql` to show the database enforcement and resulting rows. Substitute the values in `.env` if they differ from the example.

```sql
SELECT notification_type, is_read, created_at
FROM notifications
WHERE notification_type = 'break_glass_review'
ORDER BY notification_id DESC LIMIT 5;

SELECT override_id, user_id, document_id, status, granted_at, expires_at,
       reviewed_by, reviewed_at, review_outcome
FROM access_overrides
ORDER BY override_id DESC LIMIT 5;

SELECT log_id, override_id, is_break_glass, prev_hash, row_hash
FROM access_logs
WHERE is_break_glass
ORDER BY log_id DESC LIMIT 5;

SELECT verify_audit_chain();
```

## Push — search and MongoDB analytics (about 4 minutes)

1. As a Nurse, open **Search** and query `needle prick injury` in semantic mode. Show the synthetic Sharps Injury policy and its snippet. Explain that PostgreSQL applies `fn_accessible_document_ids` before ranking or retrieving snippets.
2. Repeat with keyword mode using a policy phrase. Compare it with semantic mode and point to hybrid rank fusion.
3. Open a permitted document and show **Related policies** with cosine-similarity scores.
4. Sign in as Admin and show the dashboard's frequent indexed terms. Explain the MongoDB `$unwind`, `$group`, and `$facet` aggregation behind the widget.

Before the demo, apply SQL migrations, run `npm run db:mongo:indexes`, `npm run db:mongo:seed`, and `npm run db:embeddings`. The first embedding run downloads the local model. Do not use real patient documents; all supplied policies are fictional examples.
