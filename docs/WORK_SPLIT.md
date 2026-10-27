# DocuGuard: Pull and Push Work Split

Oct 27, 2026 · @Reddy

Pull and Push each own a vertical slice that runs from SQL through Express to Next.js, so both of you write database code and application code, and neither is blocked for long waiting on the other. Remaining effort is 25 points each (section 2). Phase 0 is already done by Pull.

Save this doc in the repo as `docs/WORK_SPLIT.md` so the coding agent can read it.

## 1. How the work is divided

The split is by feature, not by layer. A layer split (one person on the database, one on the website) would break the rubric rule that each member contributes to both database and application development, and it would leave one of you idle until the other finishes.

- **Pull: Documents, access and audit.** The trust side of the platform: who you are, what you may open, what changed, and proof of who touched what.
- **Push: Search and compliance intelligence.** The insight side: finding answers by meaning, proving staff read policies, and showing regulatory gaps.

| Layer | Pull | Push |
| --- | --- | --- |
| PostgreSQL | 14 tables, version triggers, hash-chained audit log, transactions, recursive CTE | 8 tables, pgvector, full-text search, compliance views, anti-joins |
| Other database | None directly (calls Push's ingestion service) | MongoDB collections, aggregation pipelines, vector index |
| Express | Auth, documents, audit, break-glass, notifications, graph | Ingestion, search, similar documents, acknowledgments, coverage, analytics |
| Next.js | App shell, document pages, audit, break-glass, graph | Search, My Policies, coverage, keyword analytics |

SQL tables owned: Pull has DEPARTMENTS, ROLES, PERMISSIONS, ROLE\_PERMISSIONS, USERS, DOCUMENT\_CATEGORIES, DOCUMENTS, DOCUMENT\_VERSIONS, DOCUMENT\_PERMISSIONS, ACCESS\_LOGS, AUDIT\_INTEGRITY\_CHECKS, NOTIFICATIONS, ACCESS\_OVERRIDES and DOCUMENT\_REFERENCES. Push has SEARCH\_LOGS, SIMILAR\_DOCUMENTS, DOCUMENT\_CHUNKS, POLICY\_ASSIGNMENTS, ACKNOWLEDGMENTS, REGULATIONS, CONTROLS and DOCUMENT\_CONTROL\_MAP. Push has fewer tables because Push also carries MongoDB, embeddings and the seed content.

## 2. Effort balance

Points are rough estimates, where 1 point is about half a working day including tests. Adjust them after Phase 1 if one side turns out heavier.

| Pull | Points | Push | Points |
| --- | --- | --- | --- |
| Auth, RBAC, user admin, app shell | 3 | MongoDB ingestion: text extraction, chunking, keywords | 4 |
| Documents, versions, approval (maker-checker), document pages | 5 | Embeddings, hybrid permission-aware search, search page | 5 |
| Audit hash chain, verification, audit page | 4 | Similar-document detection | 2 |
| Break-glass access | 3 | MongoDB analytics aggregations and widget | 2 |
| Expiry sweeper and notifications | 3 | Acknowledgments | 3 |
| Dependency graph (recursive CTE and graph page) | 3 | Regulatory coverage and gap analysis | 3 |
| Dashboard: status, expiry, access activity widgets | 2 | Dashboard: acknowledgment, coverage, keyword widgets | 2 |
| Docs lead: ARCHITECTURE, RELATIONAL\_SCHEMA, TESTING | 2 | Seed content: synthetic policy files, regulations, demo situations | 2 |
|  |  | Docs lead: QUERIES, NOSQL\_VECTOR, RUBRIC\_CHECKLIST | 2 |
| **Remaining total** | **25** | **Remaining total** | **25** |

Pull already finished Phase 0 (about 2 points). To even this out, Push leads the final README polish and the screenshot capture.

## 3. Pull's part: Documents, access and audit

| Area | SQL | Express | Next.js |
| --- | --- | --- | --- |
| Auth and users | Roles, permissions, users tables with CHECKs; core seed | Login, logout, me; bcrypt; JWT cookie; rbac middleware; zod; helmet; login rate limit; user admin | Login page, role-aware navigation, users admin page |
| Documents and versions | Documents, versions, permissions, categories; circular-FK ALTER; version transition, approved and expired triggers; updated\_at trigger | Upload (multer, checksum), versions, approve, permission-aware list and detail | Document list, upload form, detail with version history, approval queue |
| Audit | Access logs, integrity checks, hash-chain trigger, immutability trigger, `verify_audit_chain()`, REVOKE | Audit log API with filters, verify endpoint | Audit table with filters, verify button and history |
| Break-glass | Overrides table, `fn_expire_overrides()`, review-queue view | Request transaction (override, flagged log row, admin notifications), review endpoints | Emergency access dialog, admin review page |
| Expiry and notifications | Notifications table, `fn_expiry_sweep()`, expiring-soon view, scheduler job | Notifications API | Notification bell, expiring-soon list |
| Dependency graph | References table, recursive CTE with cycle guard, retire trigger | Reference and impact endpoints | Graph page (React Flow), impact list |
| Dashboard (part) | Status summary and access activity views | Dashboard endpoints | Dashboard shell and three widgets |
| Shared pieces Pull provides | `fn_accessible_document_ids(user_id)` | `requireAuth`, `requireRole`, `logAccess()` | App shell, `lib/api.ts` |

## 4. Push's part: Search and compliance intelligence

| Area | SQL / MongoDB | Express | Next.js |
| --- | --- | --- | --- |
| Ingestion | MongoDB `document_contents` and `document_chunks` collections and indexes | Ingest service: PDF and DOCX extraction, sections, chunking, keywords, Mongo writes, compensation, orphan sweeper | Processing status on the document page |
| Embeddings | `document_chunks` with `vector(384)` and `tsvector`; HNSW and GIN indexes; pgvector extension | Embedding worker (local model), re-embed on approval | None |
| Hybrid search | Search logs; permission-filtered vector and keyword queries | Search endpoint, rank fusion, snippets from MongoDB, search logging | Search page: mode toggle, category filter, result cards |
| Similar documents | Similar-documents table; document-level vector average query | Detection job, similar endpoint | Related-policies panel |
| Analytics | MongoDB aggregation pipelines (`$unwind`, `$group`, `$facet`) | Analytics endpoints | Keyword analytics widget |
| Acknowledgments | Assignments and acknowledgments tables; pending-users anti-join; compliance view | Assignment and acknowledgment endpoints | My Policies page, admin assignment form, completion chart |
| Regulatory coverage | Regulations, controls, mapping tables; `v_control_coverage`; `fn_control_coverage_score()` | Regulation, control and mapping endpoints | Coverage matrix, gap list, score per regulation |
| Dashboard (part) | Acknowledgment and coverage views | Compliance endpoints | Three widgets |
| Seed content | Regulations and controls (marked illustrative) | Seed loader script | None |

## 5. Contracts between you

These are the handshakes. Agree them in a short call before Phase 1, then record them in `docs/DECISIONS.md`.

1. **Auth (Pull gives Push).** Express middleware `requireAuth` and `requireRole(...)`, and a `req.user` object with `id`, `roleId`, `role` and `departmentId`. Push builds services and SQL first and wires routes once Pull's Phase 2 is merged.
2. **Access filter (Pull gives Push).** A SQL function `fn_accessible_document_ids(user_id)` returning the document ids the user may read: a non-revoked role grant, or an active break-glass override that has not expired. Push's search and similar-documents queries use it, so the permission rule exists in exactly one place. Add it to the data dictionary Functions table.
3. **Ingestion (Push gives Pull).** `ingestFile(path, meta)` returns `{ mongoDocId, mongoContentId, chunkCount }`. `deleteIngested(mongoContentId)` is the compensating action if the PostgreSQL transaction fails. `queueEmbedding(versionId)` is called after the transaction commits. Push builds this during Phases 1 and 2, so it exists before Pull's upload endpoint in Phase 3. If it is late, Pull writes a clearly marked stub returning fake ids and removes it as soon as Push merges.
4. **Audit logging (Pull gives Push).** `logAccess(client, { userId, documentId, versionId, action, ip })` for any endpoint that opens a document, such as a result click-through. Push calls it and never writes to the access log directly.
5. **Notifications (Pull gives Push).** Push's acknowledgment trigger inserts straight into the notifications table using the types already in the data dictionary, so no new API is needed.

## 6. Plan by phase

Both of you work inside the same numbered phases the build prompt uses, so the agent's phase gates still work, but each person runs their own slice.

| Phase | Pull | Push | Hand-off |
| --- | --- | --- | --- |
| 1 SQL | Core schema (14 tables), circular-FK ALTER, core triggers and functions, core indexes, drop script, core seed, `fn_accessible_document_ids` | MongoDB script, compliance and search DDL (8 tables), vector and GIN indexes, compliance views, SQL negative tests, start synthetic policy files | Pull merges the core schema first (aim for the first sitting) so Push can run its file on top |
| 2 Auth | Auth, RBAC, user admin, app shell | Ingestion service and embedding worker, tested by scripts | Pull's auth and shell merged |
| 3 Documents | Upload endpoint, versions, approval, document pages, hash-chained access log, audit verify and page | Hybrid search service and similar-documents job, tested against seed data; search routes once auth is in | Pull replaces the ingestion stub with Push's service |
| 4 Search | Expiry sweeper, notifications, notification bell | Search page, similar-documents panel, analytics endpoints and widget | None |
| 5 Dashboard | Dashboard shell and widgets, dependency graph | Acknowledgments: assignments, My Policies, completion view | Pull's dashboard shell is ready for Push's widgets |
| 6 Compliance | Break-glass: transaction, review page | Regulatory coverage and gap analysis, remaining dashboard widgets | None |
| 7 Finish | Pull's tests and docs, audit tamper test rehearsal | Push's tests and docs, README polish, screenshots | Joint: full run-through, rubric checklist, demo rehearsal |

## 7. Git workflow and file ownership

- Branches are named `pull/phase-N-topic` and `push/phase-N-topic`. Nobody commits to `main` directly. Each pull request is reviewed and merged by the other person, which also forces both of you to read the other's code before the viva.
- Commit under your own identity and in small steps. Do not let the agent set authors or co-author trailers.
- Split the SQL scripts by owner so you never edit the same file: `01a_schema_core.sql` (Pull) and `01b_schema_compliance.sql` (Push), and the same a/b pattern for indexes, functions, triggers, views and seed. `03_alter.sql` and the runner script belong to Pull. The runner executes files in sorted order.
- Backend files are per feature (`routes/`, `services/`, `repositories/`), and frontend pages are per feature folder, so slices rarely collide.
- Shared files that both of you will touch: `app.ts` route registration, the navigation component, `package.json`, `.env.example`, `docs/DECISIONS.md`. Make those edits in their own small commits, and pull `main` first.
- Merge to `main` only when both of you have run the app and the tests pass on your own machines.

## 8. Documentation and demo split

| Document | Lead | Reviewer |
| --- | --- | --- |
| ARCHITECTURE, RELATIONAL\_SCHEMA, TESTING | Pull | Push |
| QUERIES, NOSQL\_VECTOR, RUBRIC\_CHECKLIST | Push | Pull |
| README, DEMO\_GUIDE, DECISIONS, OWNERSHIP | Joint (Push leads README polish) | Joint |
| SCREENSHOTS | Push captures; each supplies their own pages |  |

**Demo order.** Pull: problem and motivation, architecture, ER diagram and relational schema, DDL run live, login and roles, upload and approval, the hash-chain tamper test, break-glass. Push: keyword versus semantic search, how embeddings are stored and queried, the MongoDB model and aggregation, similar documents, acknowledgments, regulatory gap analysis, the dashboard, test cases. Both: contributions slide and Q&A.

Each of you should be able to explain the other's slice one level deep (what it does and which database features it uses), because evaluators may ask either of you about any part.

## 9. Messages to paste into the coding agent

Use these at the start of each session, together with the phase you want. Each person runs the agent in their own clone.

**Pull:**

I am Pull, one of two students. My teammate is Push. Read docs/WORK\_SPLIT.md and docs/DECISIONS.md. Build only Pull's slice for the phase I name. Do not implement Push's files; call Push's agreed interfaces, and if one is not merged yet, write a clearly marked stub and list it in your report. Name branches pull/phase-N-topic, put SQL in the a-suffixed files, and do not set git authors. Update docs/OWNERSHIP.md to use the names Pull and Push instead of Member A and Member B. Current phase: \[fill in\].

**Push:**

I am Push, one of two students. My teammate is Pull. Read docs/WORK\_SPLIT.md and docs/DECISIONS.md. Build only Push's slice for the phase I name. Do not implement Pull's files; call Pull's agreed interfaces, and if one is not merged yet, write a clearly marked stub and list it in your report. Name branches push/phase-N-topic, put SQL in the b-suffixed files, and do not set git authors. Current phase: \[fill in\].

## 10. First steps this week

1. **Pull:** merge `phase-0-setup` into `main`, push to GitHub, add Push as a collaborator, and tag it `phase-0`.
2. **Push:** clone the repo, follow the README, and get `docker compose up -d` and `/health` working on your own machine. Note that Pull moved PostgreSQL to host port 5433 because of a native Windows PostgreSQL; check whether you have the same conflict. Set your own git name and email.
3. **Both:** hold a 20 minute call to agree the five contracts in section 5, then write them into `docs/DECISIONS.md` and commit that file together.
4. **Pull** starts `01a_schema_core.sql` and `fn_accessible_document_ids`. **Push** starts the MongoDB script, `01b_schema_compliance.sql` and the ingestion service.
5. Hold a 15 minute sync at every phase boundary: what merged, what is blocked, whether the points in section 2 still look fair.
