# Relational Schema

PostgreSQL is DocuGuard's source of truth for identity, authorization, policy metadata, versions, audit events, notifications, search metadata, acknowledgments, and regulatory coverage. The complete attribute-level specifications are preserved in [`inputs/docuguard_er_diagram.mermaid`](inputs/docuguard_er_diagram.mermaid) and [`inputs/docuguard_data_dictionary.md`](inputs/docuguard_data_dictionary.md).

## Table inventory

The DDL creates **22 tables**: 14 core tables and 8 search/compliance feature tables. This is interpreted as 21 non-vector business tables plus `DOCUMENT_CHUNKS`; the ER diagram also draws `DOCUMENT_CHUNKS` as an entity, so it visually contains all 22.

| Area | Tables |
|---|---|
| Identity and RBAC | `departments`, `roles`, `permissions`, `role_permissions`, `users` |
| Policy metadata and versioning | `document_categories`, `documents`, `document_versions`, `document_permissions`, `document_references` |
| Access and audit | `access_overrides`, `access_logs`, `audit_integrity_checks`, `notifications` |
| Search and similarity | `search_logs`, `document_chunks`, `similar_documents` |
| Reading compliance | `policy_assignments`, `acknowledgments` |
| Regulatory mapping | `regulations`, `controls`, `document_control_map` |

## Relationship map

- A department and role can each be assigned to many users. `role_permissions` is a composite-key junction between roles and permissions.
- A category classifies many documents; each document has one owner and many versions. The document's nullable `current_version_id` points back to a version. `02_alter.sql` adds this circular foreign key after both tables exist.
- A version may have many `document_chunks` and audit events. An acknowledgment references a specific version so approving a new version makes users pending for that version without deleting past acknowledgments.
- `document_permissions` joins a document to a role and records read/write/approve/admin access. `fn_accessible_document_ids(user_id)` combines active role grants with active, unexpired break-glass overrides.
- `access_logs` references the actor and document, and optionally the version and override. `audit_integrity_checks` records who verified the chain and the first broken log id, if any.
- `document_references` has two foreign keys to documents, representing a directed relationship (`cites`, `depends_on`, or `supersedes`).
- `similar_documents` has two document foreign keys and stores each pair once with `document_id_1 < document_id_2`.
- `policy_assignments` targets a role, a department, or both. `acknowledgments` links the assignment, user, and acknowledged version.
- A regulation owns controls; `document_control_map` joins controls to supporting documents and records the mapper.
- Notifications belong to a user and may refer to a document.

## Important database rules

| Rule | Enforcement |
|---|---|
| Enumerated roles, statuses, access levels, relationship types, notification types, and search modes | `CHECK` constraints |
| Required values and safe referential deletion behavior | `NOT NULL` and foreign keys with explicit `ON DELETE` rules |
| Unique emails, names, document-version numbers, checksums, pairs, and junction rows | `UNIQUE` constraints or indexes |
| Maker-checker approval | `CHECK (approved_by <> uploaded_by)` plus version transition trigger |
| Expiry ordering and break-glass limits | `CHECK` constraints on effective/expiry dates and override timestamps |
| Approval state changes, current-version pointer, and expiry notifications | PostgreSQL triggers and functions |
| Audit event ordering and immutability | Advisory transaction lock, hash trigger, immutable trigger, and revoked runtime `UPDATE`/`DELETE` grants |
| Cycle-safe impact analysis | Recursive CTE with a path array; indexes exist on both reference columns |
| Permission-aware document access | `fn_accessible_document_ids(user_id)` and SQL predicates in document/search/dashboard queries |

## Views and functions used by the application

Core views include `v_document_status_summary`, `v_expiring_soon`, `v_access_activity`, and `v_break_glass_review_queue`. Search/compliance DDL adds `v_control_coverage`, `v_ack_compliance`, `v_ack_compliance_by_department`, and `v_regulatory_coverage_summary`.

Core functions include `fn_accessible_document_ids`, `verify_audit_chain`, `fn_expire_overrides`, and `fn_expiry_sweep`. `fn_control_coverage_score` computes the regulation-level score. Triggers centralize `updated_at`, version transitions, current-version promotion, expiry notifications, audit hashing/immutability, dependency retirement notifications, and acknowledgment notifications.

## Indexes and database concepts to demonstrate

- B-tree indexes support joins and filters on role, department, category, document status, active permissions, audit actor/document/time, expiry, notifications, and both dependency endpoints.
- `document_chunks.embedding` uses an HNSW index with `vector_cosine_ops`; `document_chunks.tsv` uses GIN for full-text lookup.
- Composite primary/unique keys prevent duplicate role grants, acknowledgment rows, control mappings, and similar-document pairs.
- The schema demonstrates normalization, joins, grouping, anti-joins, partial indexes, transaction boundaries, triggers, views, recursive CTEs, referential actions, and append-only audit history.

## Migration map

| File | Purpose |
|---|---|
| `01a_schema_core.sql`, `01b_schema_search.sql` | Create Pull core and Push search/compliance tables. |
| `02_alter.sql` | Add the circular current-version foreign key. |
| `03a_indexes_core.sql`, `03b_indexes_search.sql` | Add core, vector, and feature indexes. |
| `04a_functions_core.sql`, `04b_functions_search.sql` | Add access, audit, expiry, and coverage functions. |
| `05a_triggers_core.sql`, `05b_triggers_search.sql` | Add core workflow and acknowledgment triggers. |
| `06a_views_core.sql`, `06b_views_search.sql` | Add dashboard, review, acknowledgment, and coverage views. |
| `07a_seed_core.sql`, `07b_seed_search.sql` | Add fake role/account/policy and feature demo data. |
| `08_auth_runtime.sql` | Enable and configure the restricted API role. |
| `09_documents.sql` | Add unique checksum enforcement for versions. |
| `99_drop.sql` | Drop the application schema objects for a deliberate local rebuild. |

The numbered scripts are applied by `database/postgres/run_all.ps1`. The authoritative ER and data dictionary files remain unchanged under `docs/inputs/`.
