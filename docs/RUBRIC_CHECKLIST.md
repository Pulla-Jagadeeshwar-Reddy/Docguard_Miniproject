# Rubric evidence checklist

Use this with the project blueprint during the demo. “Implemented” describes committed code and documents; it does not imply a live run was observed in this workspace. The Phase 7 verification run is recorded in `TESTING.md`.

| # | Rubric area | Evidence to show | Status |
|---:|---|---|---|
| 1 | Title and real problem | DocuGuard's policy, access, acknowledgment, and audit problem in README and blueprint | Implemented |
| 2 | Two-member contribution | `WORK_SPLIT.md`, `OWNERSHIP.md`, and Pull/Push feature branches | Implemented |
| 3 | Database requirement | PostgreSQL plus MongoDB and pgvector | Implemented |
| 4 | Database design | ER diagram, data dictionary, relational schema, Mongo/vector design | Implemented |
| 5 | SQL implementation | Numbered create/alter/index/function/trigger/view/seed scripts and drop script | Implemented |
| 6 | Database operations | Application CRUD actions and examples in `QUERIES.md` | Implemented |
| 7 | Advanced database features | Constraints, ACID transactions, triggers, views, stored functions, GIN/HNSW indexes, full text, vector similarity, recursive CTEs | Implemented |
| 8 | Semantic search | 384-dimensional local embeddings, permission-filtered semantic retrieval, keyword and hybrid modes | Implemented; integration test added |
| 9 | Next.js interface | Login, document workflow, search, My Policies, coverage, audit, break-glass, dashboard pages | Implemented |
| 10 | Integration | Next.js → Express → PostgreSQL/MongoDB; API routes and environment configuration | Implemented |
| 11 | Authentication and roles | bcrypt, HTTP-only JWT cookie, dynamic RBAC, Admin/Doctor/Nurse/Staff | Implemented |
| 12 | Validation and integrity | Zod edges, SQL CHECK/UNIQUE/FK constraints, transactional workflows, audit and acknowledgment triggers | Implemented |
| 13 | Security | Permission-filtered reads/search, parameterized SQL, non-public uploads, restricted runtime DB role, append-only audit | Implemented |
| 14 | Documentation | README, architecture, schema, testing, query, NoSQL/vector, demo, rubric, ownership, and phase notes | Implemented |
| 15 | Git/GitHub | Per-phase Push branches, commits, and pushes | Implemented; review/merge remains a team action |
| 16 | Demonstration | Runbook in `DEMO_GUIDE.md`; capture states listed in `SCREENSHOTS.md` | Script ready; screenshots require a running local demo |
| 17 | Originality | Break-glass review, tamper-evident audit chain, policy version acknowledgment, compliance gaps | Implemented |
| 18 | Level 3 database expectation | PostgreSQL plus MongoDB; vector retrieval uses PostgreSQL pgvector | Implemented |

## Demo evidence order

1. Explain the problem and design using the ER diagram and relational schema.
2. Show authentication, role filtering, upload/version approval, and audit verification.
3. Compare keyword, semantic, and hybrid search, then show similar policies.
4. Show the MongoDB collection shape and aggregation widget.
5. Assign a policy, acknowledge a version, and show completion.
6. Show regulation score and the expired-only mandatory-control gap test.
7. Run the available SQL/API checks and review the screenshot evidence.

Never describe the example regulations or policies as official standards, clinical advice, or real patient data.
