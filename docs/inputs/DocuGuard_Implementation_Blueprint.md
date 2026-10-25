# DocuGuard: Implementation Blueprint

## DocuGuard: Implementation Blueprint

Healthcare Policy & Compliance Intelligence Platform | DBMS Level 3 Project | Next.js + Express.js + PostgreSQL + MongoDB + pgvector

### 1. A note on the stack

The project rubric makes a SQL database mandatory (MySQL or PostgreSQL), so Next.js + Express + MongoDB alone would not qualify. The final stack is:

| Layer | Technology | Role |

| --- | --- | --- |

| Frontend | Next.js (App Router) | UI, route protection, dashboards |

| Backend/API | Express.js | Authentication, RBAC, business logic, ingestion, search orchestration |

| SQL | PostgreSQL | Users, roles, documents, versions, permissions, audit, compliance data |

| NoSQL | MongoDB | Extracted document content, chunks, flexible metadata, analytics aggregation |

| Vector | pgvector (inside PostgreSQL) | Chunk embeddings and similarity search |



That is three database paradigms, above the rubric minimum of two. pgvector is recommended over a separate vector service because permission filtering, keyword search and vector search can then run in one SQL query (section 9).

### 2. Problem statement

Hospitals run on written policies: infection-control SOPs, privacy guidelines, safety protocols, regulatory documents. In practice these sit in shared drives and email threads. Staff cannot find the right procedure quickly, expired documents stay in circulation, nobody can prove who read a changed policy, confidential documents leak through careless search, and access logs can be quietly edited. During an accreditation audit (NABH, JCI) or a privacy incident (HIPAA, India's DPDP Act) these gaps become findings.

DocuGuard is a centralized platform that stores policies with strict version control, answers natural-language questions using only the documents the asker is allowed to see, and produces audit-grade evidence of who accessed and acknowledged what.

### 3. Objectives

Store policy documents with versioning, approval and expiry tracking.

Let staff find answers by meaning, not only exact keywords, without ever exposing unauthorized content.

Prove compliance through acknowledgment tracking, regulatory coverage analysis and tamper-evident audit logs.

Handle emergencies safely through time-limited, reviewed break-glass access.

Demonstrate sound database design and use across SQL, NoSQL and vector paradigms.

### 4. Scope

In scope: the twelve features in section 13, four roles, a Next.js web interface, seeded demo data, documentation and tests.

Out of scope (future work): OCR of scanned images, LLM-generated cited answers (RAG), multilingual search, integration with a real hospital information system, a mobile app.

### 5. Users and roles

| Role | Can do |

| --- | --- |

| Admin | Manage users and roles; upload and approve documents (approver must differ from uploader); map documents to regulations; create reading assignments; review break-glass events; run audit integrity checks |

| Doctor | Search and read permitted clinical and general documents; upload drafts; acknowledge assigned policies; request break-glass access |

| Nurse | Same as Doctor for nursing and clinical categories, without upload |

| Staff | Search and read non-clinical documents (safety, privacy, administration); acknowledge assigned policies |



Seed at least two Admin accounts so the maker-checker rule can be demonstrated live.

### 6. System architecture

Browser
  |  HTTPS
Next.js (port 3000): pages, middleware (redirect if no session cookie)
  |  rewrites /api/* to Express
Express.js (port 4000)
  |- middleware: helmet, cors, rate-limit, JWT auth, rbac, zod validation
  |- routes -> controllers -> services -> repositories
  |- jobs: embedding worker, expiry sweeper (node-cron)
  |--> PostgreSQL + pgvector (pg Pool, parameterized queries, transactions)
  |--> MongoDB (official driver or Mongoose)
  '--> local file storage (uploads/, outside any public folder)

Rule: Next.js never talks to a database. All data access goes through Express, and Express re-checks authorization on every request. Next.js middleware is only a convenience redirect, never the security boundary.

### 7. Database choice and justification

| Data | Store | Why |

| --- | --- | --- |

| Users, roles, permissions, documents, versions, assignments, acknowledgments, audit logs | PostgreSQL | Strongly relational; needs foreign keys, CHECK constraints, ACID transactions, triggers and views |

| Extracted text by page and section, chunk text, per-document metadata (keywords, tables, detected dates) | MongoDB | Shape varies by document type, content is nested and large, and aggregation pipelines suit analytics; forcing this into fixed columns would be awkward |

| Chunk embeddings | pgvector | Similarity search sits next to the permission tables, so access filtering and ranking happen in one query with no cross-store join or sync problem |



This is the justification the rubric asks for: each store holds the data it fits best, and none is included only for show.

### 8. Project structure

docuguard/
  README.md
  docker-compose.yml          # pgvector/pgvector:pg16 + mongo:7
  docs/                       # ER diagram, data dictionary, screenshots, test results
  database/
    postgres/
      01_schema.sql           # CREATE TABLE + constraints
      02_alter.sql            # circular FK, later changes (ALTER)
      03_indexes.sql
      04_functions.sql        # audit chain, verify_audit_chain(), helpers
      05_triggers.sql
      06_views.sql
      07_seed.sql
      99_drop.sql             # clean teardown (DROP)
    mongo/ indexes.js  seed.js  aggregations.js
  backend/                    # Express.js
    .env.example
    src/
      app.js  server.js
      config/ env.js  pg.js  mongo.js
      middleware/ auth.js  rbac.js  validate.js  errors.js  rateLimit.js
      routes/ controllers/ repositories/
      services/ ingest.js  embeddings.js  search.js  audit.js  breakglass.js
      jobs/ expirySweeper.js  embeddingWorker.js
  frontend/                   # Next.js App Router
    app/ login  dashboard  documents  search  my-policies  compliance  admin
    components/  lib/api.js  middleware.js

### 9. PostgreSQL implementation

The relational schema is the 21-table ER diagram and the data dictionary already prepared. Run the scripts in numeric order with psql. One extra table holds the vector data:

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE document_chunks (
  chunk_id BIGSERIAL PRIMARY KEY,
  version_id INT NOT NULL REFERENCES document_versions(version_id) ON DELETE CASCADE,
  chunk_index INT NOT NULL CHECK (chunk_index >= 0),
  mongo_chunk_id VARCHAR(64) NOT NULL UNIQUE,
  embedding vector(384) NOT NULL,
  tsv tsvector NOT NULL,
  UNIQUE (version_id, chunk_index)
);
CREATE INDEX idx_chunks_embedding ON document_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_chunks_tsv ON document_chunks USING gin (tsv);

tsv stores only search lexemes, not the raw text; the readable snippet is fetched from MongoDB by mongo_chunk_id. The vector_id column on document_versions can simply be set once embeddings exist for that version.

Permission-aware vector search. Authorization is part of the query, so unauthorized rows never leave the database:

SELECT c.chunk_id, c.mongo_chunk_id, d.document_id, d.title,
       1 - (c.embedding <=> $1) AS similarity
FROM document_chunks c
JOIN document_versions v ON v.version_id = c.version_id
JOIN documents d ON d.document_id = v.document_id
                AND d.current_version_id = v.version_id
WHERE v.version_status = 'approved'
  AND (v.expiry_date IS NULL OR v.expiry_date >= CURRENT_DATE)
  AND (
    EXISTS (SELECT 1 FROM document_permissions p
            WHERE p.document_id = d.document_id AND p.role_id = $2
              AND p.revoked_at IS NULL)
    OR EXISTS (SELECT 1 FROM access_overrides o
               WHERE o.document_id = d.document_id AND o.user_id = $3
                 AND o.status = 'active' AND o.expires_at > now())
  )
ORDER BY c.embedding <=> $1
LIMIT 20;

The keyword query is the same shape with c.tsv @@ websearch_to_tsquery('english', $1) and ts_rank. With a restrictive filter, raise hnsw.ef_search (or use pgvector's iterative scan) so enough candidates survive filtering.

Tamper-evident audit chain (BEFORE INSERT trigger on access_logs):

CREATE FUNCTION audit_chain() RETURNS trigger AS $$
DECLARE last_hash CHAR(64);
BEGIN
  PERFORM pg_advisory_xact_lock(727001);   -- serialize concurrent inserts
  SELECT row_hash INTO last_hash FROM access_logs ORDER BY log_id DESC LIMIT 1;
  NEW.prev_hash := COALESCE(last_hash, repeat('0', 64));
  NEW.row_hash := encode(digest(
    NEW.prev_hash || NEW.log_id || NEW.user_id || NEW.document_id ||
    NEW.action || NEW.accessed_at::text, 'sha256'), 'hex');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

A second trigger raises an exception on UPDATE or DELETE of access_logs, and the application database role has those privileges revoked. verify_audit_chain() recomputes every hash in order and returns the first log_id that does not match.

Dependency impact analysis (recursive CTE with cycle protection):

WITH RECURSIVE impacted AS (
  SELECT source_document_id AS doc_id, 1 AS depth,
         ARRAY[target_document_id, source_document_id] AS path
  FROM document_references WHERE target_document_id = $1
  UNION ALL
  SELECT r.source_document_id, i.depth + 1, i.path || r.source_document_id
  FROM document_references r JOIN impacted i ON r.target_document_id = i.doc_id
  WHERE NOT r.source_document_id = ANY(i.path)
)
SELECT d.document_id, d.title, MIN(i.depth) AS depth
FROM impacted i JOIN documents d ON d.document_id = i.doc_id
GROUP BY d.document_id, d.title ORDER BY depth;

Views to create: v_document_status_summary, v_expiring_soon, v_access_activity, v_ack_compliance, v_control_coverage, v_break_glass_review_queue. The dashboard reads these directly.

#### Relational schema (ER diagram converted to tables)

The rubric asks for the ER diagram to be converted into a relational schema, so the documentation needs this form too. Mapping rules used: every entity becomes a relation; every many-to-many link (roles to permissions, documents to controls) becomes a junction table with a composite primary key; every one-to-many link puts a foreign key on the many side; the two self-relationships on documents (similar documents, references) become tables with two foreign keys to DOCUMENTS; the circular link between DOCUMENTS and DOCUMENT_VERSIONS is closed with ALTER TABLE. Every relation is designed to be in third normal form: non-key columns depend only on the key.

DEPARTMENTS(department_id PK, department_name UK, description)
ROLES(role_id PK, role_name UK, description)
PERMISSIONS(permission_id PK, permission_name UK, description)
ROLE_PERMISSIONS(role_id PK FK->ROLES, permission_id PK FK->PERMISSIONS, assigned_at)
USERS(user_id PK, full_name, email UK, password_hash, role_id FK->ROLES,
      department_id FK->DEPARTMENTS, employment_status, account_status,
      created_at, last_login_at)
DOCUMENT_CATEGORIES(category_id PK, category_name UK, description)
DOCUMENTS(document_id PK, title, category_id FK->DOCUMENT_CATEGORIES,
          owner_id FK->USERS, current_version_id FK->DOCUMENT_VERSIONS (via ALTER),
          mongo_doc_id UK, document_status, created_at, updated_at)
DOCUMENT_VERSIONS(version_id PK, document_id FK->DOCUMENTS, version_number,
          file_path, mongo_content_id UK, vector_id UK, checksum,
          uploaded_by FK->USERS, approved_by FK->USERS, uploaded_at, approved_at,
          effective_date, expiry_date, version_status;
          UNIQUE(document_id, version_number))
DOCUMENT_PERMISSIONS(doc_permission_id PK, document_id FK->DOCUMENTS,
          role_id FK->ROLES, access_level, granted_by FK->USERS, granted_at,
          revoked_at; UNIQUE(document_id, role_id, access_level))
ACCESS_LOGS(log_id PK, user_id FK->USERS, document_id FK->DOCUMENTS,
          version_id FK->DOCUMENT_VERSIONS, override_id FK->ACCESS_OVERRIDES,
          action, is_break_glass, ip_address, accessed_at, prev_hash, row_hash UK)
AUDIT_INTEGRITY_CHECKS(check_id PK, run_by FK->USERS, run_at, rows_verified,
          result, first_broken_log_id)
SEARCH_LOGS(search_id PK, user_id FK->USERS, query_text, search_type,
          results_count, searched_at)
SIMILAR_DOCUMENTS(similarity_id PK, document_id_1 FK->DOCUMENTS,
          document_id_2 FK->DOCUMENTS, similarity_score, detection_method,
          detected_at; UNIQUE(document_id_1, document_id_2))
NOTIFICATIONS(notification_id PK, user_id FK->USERS, document_id FK->DOCUMENTS,
          notification_type, message, is_read, created_at)
POLICY_ASSIGNMENTS(assignment_id PK, document_id FK->DOCUMENTS,
          target_role_id FK->ROLES, target_department_id FK->DEPARTMENTS,
          assigned_by FK->USERS, assigned_at, due_date)
ACKNOWLEDGMENTS(ack_id PK, assignment_id FK->POLICY_ASSIGNMENTS,
          user_id FK->USERS, version_id FK->DOCUMENT_VERSIONS, acknowledged_at;
          UNIQUE(assignment_id, user_id, version_id))
REGULATIONS(regulation_id PK, regulation_name UK, issuing_body, description)
CONTROLS(control_id PK, regulation_id FK->REGULATIONS, control_code, title,
          description, is_mandatory; UNIQUE(regulation_id, control_code))
DOCUMENT_CONTROL_MAP(document_id PK FK->DOCUMENTS, control_id PK FK->CONTROLS,
          mapped_by FK->USERS, mapped_at)
ACCESS_OVERRIDES(override_id PK, user_id FK->USERS, document_id FK->DOCUMENTS,
          justification, granted_at, expires_at, status, reviewed_by FK->USERS,
          reviewed_at, review_outcome)
DOCUMENT_REFERENCES(reference_id PK, source_document_id FK->DOCUMENTS,
          target_document_id FK->DOCUMENTS, reference_type, created_at;
          UNIQUE(source_document_id, target_document_id, reference_type))
DOCUMENT_CHUNKS(chunk_id PK, version_id FK->DOCUMENT_VERSIONS, chunk_index,
          mongo_chunk_id UK, embedding, tsv; UNIQUE(version_id, chunk_index))

Column types, NOT NULL, CHECK and DEFAULT rules for each relation are in the data dictionary file.

### 10. MongoDB implementation

Collections

document_contents holds one document per version:

{ versionId, documentId, category, fileName, mimeType, pageCount,
  pages: [ { n, text } ],
  sections: [ { heading, level, pageStart } ],
  extracted: { keywords: [], wordCount, language, tables: [], datesMentioned: [] },
  createdAt }

document_chunks holds one document per chunk, the source of truth for display text:

{ _id, versionId, documentId, chunkIndex, heading, page, text, tokenCount }

Indexes: unique { versionId: 1 } on contents; unique { versionId: 1, chunkIndex: 1 } on chunks; multikey { 'extracted.keywords': 1 }; { category: 1 }.

Aggregation (NoSQL analytics for the dashboard): top keywords per category.

db.document_contents.aggregate([
  { $unwind: '$extracted.keywords' },
  { $group: { _id: { category: '$category', keyword: '$extracted.keywords' },
              n: { $sum: 1 } } },
  { $sort: { n: -1 } },
  { $limit: 20 }
])

Add a second pipeline using $facet for word count and page count per category, and a third using $group to find the longest documents. Keep these in database/mongo/aggregations.js so they can be shown in the demo.

### 11. Vector and semantic search (the five points the rubric asks to explain)

| Question | Answer |

| --- | --- |

| What is converted to embeddings? | Every chunk of an approved document version (about 300 tokens with 50 token overlap, prefixed with document title and section heading), plus each user query at search time |

| Which model? | all-MiniLM-L6-v2 (384 dimensions) run locally through @xenova/transformers. Local inference needs no API key and keeps hospital text off third-party servers |

| How are vectors stored? | document_chunks.embedding vector(384) in PostgreSQL with an HNSW index |

| Similarity metric? | Cosine distance (<=>), reported as similarity = 1 - distance |

| How are results retrieved? | Embed the query, run the permission-filtered vector query and the permission-filtered keyword query, merge the two ranked lists with Reciprocal Rank Fusion (score = sum of 1 / (60 + rank)), group chunks by document, then fetch snippets from MongoDB |



Similar-document detection: after a version is embedded, compute its document-level vector (avg(embedding) over its chunks) and find nearest neighbours among other active documents. Store pairs scoring 0.85 or higher in similar_documents, always with document_id_1 < document_id_2 so a pair is never stored twice. Admins review these as possible duplicates or conflicts.

### 12. Request flows worth implementing carefully

Upload and ingestion (the main multi-store flow)

multer accepts PDF or DOCX only, up to 20 MB, checking both extension and MIME type. Compute a SHA-256 checksum and reject the file if the checksum already exists.

Extract text (pdf-parse or mammoth), detect headings, build chunks and keywords.

Write the content and chunk documents to MongoDB.

Open a PostgreSQL transaction: insert the document (if new), insert the version as pending_review, insert an access log row, commit.

If step 4 fails, delete the MongoDB documents written in step 3 (compensating action). PostgreSQL stays the authority; MongoDB entries without a matching version are treated as orphans and swept.

A background worker embeds the chunks, inserts document_chunks, then runs similar-document detection.

Approval: a different Admin approves. In one transaction the new version becomes approved, the previous version becomes superseded, documents.current_version_id is updated, and triggers create notifications. A CHECK constraint (approved_by <> uploaded_by) enforces maker-checker in the database itself.

Break-glass access: one transaction inserts the access_overrides row (justification of at least 20 characters, expiry at most 24 hours ahead), inserts a flagged access_logs row, and inserts break_glass_review notifications for every Admin. Any failure rolls back all three.

### 13. Features and how each is built

| # | Feature | Backend and database | Frontend |

| --- | --- | --- | --- |

| 1 | Login and role-based access | bcrypt (cost 12), JWT in httpOnly cookie, rbac middleware reading role permissions | Login page, role-aware navigation |

| 2 | Upload, storage, versioning | Flow in section 12; UNIQUE (document_id, version_number) | Upload form with progress, version history table |

| 3 | Approval workflow | Maker-checker CHECK, state-transition trigger | Pending-approval queue |

| 4 | Expiry tracking | expiry_date CHECK, nightly sweeper marks versions expired, trigger creates expiry_warning at 30/7 days | Expiring-soon list, status badges |

| 5 | Hybrid permission-aware search | Section 9 queries plus RRF | Search box, category filter, ranked results with snippets |

| 6 | Similar-document detection | Section 11 | Panel on document page listing related policies and scores |

| 7 | Audit and access history | Hash-chained access_logs, insert-only | Filterable audit table (user, document, action, date) |

| 8 | Read-and-acknowledge | policy_assignments, acknowledgments; pending computed by anti-join | My Policies page; Admin per-department completion chart |

| 9 | Regulatory gap analysis | regulations, controls, document_control_map, v_control_coverage | Coverage matrix, gap list, score per regulation |

| 10 | Break-glass access | Section 12 transaction, expiry sweeper, review queue view | Emergency access dialog, Admin review page |

| 11 | Tamper-evident audit | verify_audit_chain(), audit_integrity_checks | Verify integrity button with result history |

| 12 | Dependency graph | Recursive CTE, document_references | Interactive graph (React Flow) and impact list |



The compliance dashboard (Recharts) combines document status counts, versions, expiry timeline, access activity per day, acknowledgment completion and regulatory coverage, all from views.

### 14. API and pages

| Method and path | Access | Purpose |

| --- | --- | --- |

| POST /api/auth/login, /logout; GET /api/auth/me | Public / any | Session |

| GET, POST, PATCH /api/users | Admin | User and role management |

| GET /api/documents | Any (filtered) | Permission-aware list with filters |

| POST /api/documents | Admin, Doctor | Upload new document |

| GET /api/documents/:id | Permitted | Read; writes access log |

| POST /api/documents/:id/versions | Admin, Doctor | Upload new version |

| POST /api/versions/:id/approve | Admin | Approve (not the uploader) |

| GET /api/search?q=&mode=&category= | Any | Keyword, semantic or hybrid |

| GET /api/documents/:id/similar | Permitted | Similar documents |

| GET /api/documents/:id/impact | Admin | Recursive dependency impact |

| POST /api/documents/:id/references | Admin | Add dependency link |

| POST /api/assignments | Admin | Assign policy to role or department |

| GET /api/acknowledgments/mine; POST /api/acknowledgments | Any | Pending and acknowledge |

| GET /api/compliance/(expiry, activity, acknowledgments, coverage) | Admin | Dashboard data |

| GET, POST /api/regulations, /controls, /control-map | Admin | Regulatory mapping |

| POST /api/overrides; GET /api/overrides/pending; POST /api/overrides/:id/review | Doctor, Nurse / Admin | Break-glass |

| GET /api/audit/logs; POST /api/audit/verify | Admin | Audit view and integrity check |

| GET /api/analytics/keywords | Admin | MongoDB aggregation |

| GET /api/notifications; PATCH /api/notifications/:id | Any | Alerts |



Next.js pages: /login, /dashboard, /documents, /documents/new, /documents/[id], /documents/[id]/impact, /search, /my-policies, /compliance/coverage, /compliance/acknowledgments, /admin/users, /admin/audit, /admin/break-glass.

Suggested UI libraries: Tailwind CSS, react-hook-form with zod, Recharts, React Flow. Proxy API calls through next.config.js rewrites so the browser only talks to one origin.

### 15. Security, validation and configuration

Passwords: bcrypt with cost 12; never logged or returned.

Sessions: short-lived JWT (1 hour) in an httpOnly, SameSite=Lax cookie; Secure in production.

Input validation: zod schemas at the API edge, then database CHECK, NOT NULL, UNIQUE and FOREIGN KEY constraints as the final guard (the rubric requires database-level validation).

SQL injection: parameterized queries only; no string-built SQL anywhere.

HTTP hardening: helmet, CORS limited to the frontend origin, rate limit on login (for example 5 attempts per minute), request body size limits, generic error messages in production.

Uploads: type and size allow-list, random stored filenames, files kept outside any public folder, never executed.

Database roles: the app connects as a role without UPDATE or DELETE on access_logs; migrations use a separate admin role.

Configuration: all secrets in environment variables, .env listed in .gitignore, a committed .env.example:

PG_HOST=  PG_PORT=5432  PG_DATABASE=docuguard  PG_USER=  PG_PASSWORD=
MONGO_URI=  MONGO_DB=docuguard
JWT_SECRET=  JWT_EXPIRES_IN=1h
FRONTEND_ORIGIN=http://localhost:3000
UPLOAD_DIR=./uploads  EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2

### 16. Advanced database features checklist

The rubric needs at least four. This design delivers nine.

| Concept | Where it is used |

| --- | --- |

| Transactions | Upload, approval, break-glass request |

| Triggers | Hash chain, insert-only audit, maker-checker, updated_at, expiry and acknowledgment notifications |

| Views | Dashboard views, review queue, coverage |

| Stored functions | verify_audit_chain(), coverage score function |

| Indexing | HNSW, GIN, composite and partial indexes (break-glass rows, access logs by time) |

| Full-text search | tsvector with websearch_to_tsquery |

| Vector similarity search | pgvector cosine search, similar-document detection |

| NoSQL aggregation | MongoDB keyword and category pipelines |

| Recursive queries | Dependency impact CTE |



Also show in queries: JOIN, GROUP BY with HAVING (department acknowledgment completion below 80 percent), aggregates, subqueries (documents with no mapped control), ORDER BY, and window functions (rank users by download volume, flag off-hours bursts).

#### DML coverage in the application

The rubric wants INSERT, UPDATE, DELETE and SELECT used in meaningful application actions, not only in scripts. Plan for each to appear in a visible user action:

| Operation | Application actions |

| --- | --- |

| INSERT | Upload document or version, write access log, record acknowledgment, create break-glass override, log a search, add dependency link |

| UPDATE | Approve version (status and current version), revoke a document permission (sets revoked_at), review an override, mark notification read, expire a version, edit user role or account status |

| DELETE | Remove a draft version before approval, remove a dependency link, remove a role permission, clear old read notifications |

| SELECT | Search, document lists, dashboard views, audit filters, impact analysis |



Access logs are the exception: they are insert-only by design, so audit rows are never updated or deleted.

### 17. Testing

| # | Test | Expected result |

| --- | --- | --- |

| 1 | Login with wrong password | 401, message does not reveal whether the email exists |

| 2 | SQL injection string in search box | Treated as plain text, no error, no leak |

| 3 | Nurse searches for content of an Admin-only document | Document and snippets absent from results |

| 4 | Upload an identical file twice | Second upload rejected by checksum |

| 5 | Uploader approves own version | Rejected by database CHECK |

| 6 | Expiry date earlier than effective date | CHECK violation |

| 7 | Approve version 2 | Version 1 superseded, current version updated, all in one transaction |

| 8 | Force a failure mid-upload | No orphan PostgreSQL rows; MongoDB entries removed |

| 9 | UPDATE or DELETE on access_logs | Exception raised |

| 10 | Edit a log row as superuser, run verify | Result tampered, first broken log_id reported |

| 11 | Break-glass with a 5-character justification | Rejected |

| 12 | Use a document after override expiry | Access denied, excluded from search |

| 13 | Approve a new version of an assigned policy | Users show as pending again |

| 14 | Add a circular reference A to B to A, run impact | Terminates, no infinite loop |

| 15 | Mandatory control backed only by an expired document | Appears as a gap |

| 16 | Query 'needle prick injury' | Semantic mode finds the 'sharps injury' policy that keyword mode misses |



Record results with screenshots for the documentation. Use Jest with Supertest for API tests and plain SQL scripts for database tests.

### 18. Team split and Git workflow

Both members must work on database and application code, so split by vertical slices:

Member A: PostgreSQL schema, constraints and triggers; auth and RBAC; documents, versions, approval; audit hash chain; break-glass. UI: login, document pages, admin audit and break-glass pages.

Member B: MongoDB schema and ingestion; embeddings, hybrid search, similar documents; acknowledgments; regulatory coverage; dependency graph. UI: search, dashboard, compliance pages.

Both: seed data, tests, documentation, and review of each other's pull requests.

Git: protected main; short-lived feature/<name> branches; pull requests with one reviewer; clear commit messages (for example feat(search): add RRF merge). Commit in small steps so individual contributions are visible in history. The README must cover prerequisites, .env setup, database setup commands, run commands, and demo accounts.

### 19. Build order

| Phase | Work |

| --- | --- |

| 0 | Repository, docker-compose (pgvector/pgvector:pg16 and mongo:7), env files |

| 1 | SQL scripts 01 to 07 and 99, seed data for roles, users, categories, regulations |

| 2 | Express skeleton, config, error handling, auth, RBAC middleware |

| 3 | Documents, versions, upload, approval, access logging with hash chain |

| 4 | MongoDB ingestion, embedding worker, hybrid search, similar documents |

| 5 | Notifications, expiry sweeper, dashboard views and charts |

| 6 | Acknowledgments, regulatory mapping, break-glass, dependency graph |

| 7 | Hardening, tests, screenshots, documentation, demo rehearsal |



If time runs short, cut in this order: dependency graph visuals (keep the CTE), multilingual and RAG ideas, extra charts. Never cut search, audit chain, or the permission filter, because they carry the project.

### 20. Documentation and demo checklist

The rubric's documentation list maps to material you already have or will generate:

| Required item | Source |

| --- | --- |

| Problem statement, objectives, scope, functional requirements | Sections 2 to 5 and 13 of this document |

| ER diagram, relational schema | The ER diagram file; the relational schema is in section 9 of this document |

| Database choice and justification | Section 7 |

| Data dictionary | The data dictionary file |

| SQL, NoSQL and vector implementation | Scripts in database/, sections 9 to 11 |

| Important queries | Sections 9, 10 and 16 |

| System architecture | Section 6 |

| Screenshots, testing results | Captured in phase 7, using section 17 |

| Conclusion and future work | Out-of-scope list in section 4 |



Suggested demo order: problem and motivation, ER diagram and design, DDL run live, key queries, the Next.js interface, database integration (show a UI action and the resulting rows), advanced features (hash chain tamper test is the strongest moment), test cases, individual contributions.

### 21. Rubric traceability

| Rubric item | How DocuGuard meets it |

| --- | --- |

| 1 Title, real problem, not CRUD | Compliance problem; search, audit chain, recursion, workflows go well beyond CRUD |

| 2 Two-member team | Vertical split in section 18 |

| 3 Database requirement | PostgreSQL (mandatory) with MongoDB and pgvector |

| 4 Database design | ER diagram, relational schema (section 9), data dictionary, Mongo and vector models in sections 10 and 11 |

| 5 SQL implementation | CREATE, ALTER (circular FK), DROP script, keys, constraints, indexes, views |

| 6 Database operations | Full DML mapped to application actions (section 16), plus JOIN, GROUP BY, HAVING, subqueries, window functions |

| 7 Advanced features | Nine delivered (section 16) |

| 8 Semantic search | Section 11 answers all five required explanations |

| 9 Next.js interface | Section 14 pages with forms, tables, filters, dashboards |

| 10 Integration | Express layer, environment variables only |

| 11 Authentication, roles | Four roles, JWT, RBAC |

| 12 Validation and integrity | Database-level constraints, transactions, triggers |

| 13 Security | Section 15 |

| 14 Documentation | Section 20 |

| 15 Git/GitHub | Section 18 |

| 16 Demonstration | Section 20 demo order |

| 17 Originality | Break-glass, tamper-evident chain and regulatory gap analysis are uncommon in student projects; keep your own domain details (hospital categories, controls) specific |

| 18 Level 3 expectation | Each database is justified by its data (section 7) |
