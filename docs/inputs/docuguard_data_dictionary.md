# DocuGuard — Data Dictionary & Constraint Specification

This document complements `docuguard_er_diagram.mermaid`. Mermaid's ER notation
only supports `PK`, `FK`, and `UK` markers, so `NOT NULL`, `CHECK`, `DEFAULT`,
and composite `UNIQUE` rules are specified here instead, for the DDL implementation.

## DEPARTMENTS
| Column | Type | Constraints |
|---|---|---|
| department_id | SERIAL | PRIMARY KEY |
| department_name | VARCHAR(100) | NOT NULL, UNIQUE |
| description | TEXT | — |

## ROLES
| Column | Type | Constraints |
|---|---|---|
| role_id | SERIAL | PRIMARY KEY |
| role_name | VARCHAR(50) | NOT NULL, UNIQUE, CHECK (role_name IN ('Admin','Doctor','Nurse','Staff')) |
| description | TEXT | — |

## PERMISSIONS
| Column | Type | Constraints |
|---|---|---|
| permission_id | SERIAL | PRIMARY KEY |
| permission_name | VARCHAR(100) | NOT NULL, UNIQUE |
| description | TEXT | — |

## ROLE_PERMISSIONS
| Column | Type | Constraints |
|---|---|---|
| role_id | INT | PRIMARY KEY (composite), FOREIGN KEY → ROLES, ON DELETE CASCADE |
| permission_id | INT | PRIMARY KEY (composite), FOREIGN KEY → PERMISSIONS, ON DELETE CASCADE |
| assigned_at | TIMESTAMP | NOT NULL, DEFAULT now() |

## USERS
| Column | Type | Constraints |
|---|---|---|
| user_id | SERIAL | PRIMARY KEY |
| full_name | VARCHAR(150) | NOT NULL |
| email | VARCHAR(255) | NOT NULL, UNIQUE, CHECK (email LIKE '%@%') |
| password_hash | VARCHAR(255) | NOT NULL — bcrypt/argon2 hash, never plaintext |
| role_id | INT | NOT NULL, FOREIGN KEY → ROLES, ON DELETE RESTRICT |
| department_id | INT | FOREIGN KEY → DEPARTMENTS, ON DELETE SET NULL |
| employment_status | VARCHAR(20) | DEFAULT 'active' |
| account_status | VARCHAR(20) | NOT NULL, DEFAULT 'active', CHECK (account_status IN ('active','suspended','disabled')) |
| created_at | TIMESTAMP | NOT NULL, DEFAULT now() |
| last_login_at | TIMESTAMP | — |

## DOCUMENT_CATEGORIES
| Column | Type | Constraints |
|---|---|---|
| category_id | SERIAL | PRIMARY KEY |
| category_name | VARCHAR(100) | NOT NULL, UNIQUE |
| description | TEXT | — |

## DOCUMENTS
| Column | Type | Constraints |
|---|---|---|
| document_id | SERIAL | PRIMARY KEY |
| title | VARCHAR(255) | NOT NULL |
| category_id | INT | NOT NULL, FOREIGN KEY → DOCUMENT_CATEGORIES, ON DELETE RESTRICT |
| owner_id | INT | NOT NULL, FOREIGN KEY → USERS, ON DELETE RESTRICT |
| current_version_id | INT | FOREIGN KEY → DOCUMENT_VERSIONS, NULL until first version is approved (deferred/nullable FK to break the circular dependency with DOCUMENT_VERSIONS) |
| mongo_doc_id | VARCHAR(64) | NOT NULL, UNIQUE — reference into MongoDB |
| document_status | VARCHAR(20) | NOT NULL, DEFAULT 'draft', CHECK (document_status IN ('draft','active','under_review','retired')) |
| created_at | TIMESTAMP | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMP | NOT NULL, DEFAULT now() — auto-updated via trigger |

## DOCUMENT_VERSIONS
| Column | Type | Constraints |
|---|---|---|
| version_id | SERIAL | PRIMARY KEY |
| document_id | INT | NOT NULL, FOREIGN KEY → DOCUMENTS, ON DELETE CASCADE |
| version_number | INT | NOT NULL, CHECK (version_number > 0), **UNIQUE (document_id, version_number)** — composite unique constraint |
| file_path | VARCHAR(500) | NOT NULL |
| mongo_content_id | VARCHAR(64) | NOT NULL, UNIQUE |
| vector_id | VARCHAR(64) | UNIQUE — nullable until embedding is generated |
| checksum | VARCHAR(128) | NOT NULL — for duplicate/tamper detection |
| uploaded_by | INT | NOT NULL, FOREIGN KEY → USERS, ON DELETE RESTRICT |
| approved_by | INT | FOREIGN KEY → USERS, ON DELETE RESTRICT, NULL until approved, **CHECK (approved_by <> uploaded_by)** — maker-checker rule |
| uploaded_at | TIMESTAMP | NOT NULL, DEFAULT now() |
| approved_at | TIMESTAMP | NULL until approved, CHECK ((approved_by IS NULL) = (approved_at IS NULL)) |
| effective_date | DATE | NOT NULL |
| expiry_date | DATE | CHECK (expiry_date > effective_date) |
| version_status | VARCHAR(20) | NOT NULL, DEFAULT 'pending_review', CHECK (version_status IN ('pending_review','approved','superseded','expired')) |

## DOCUMENT_CHUNKS (vector and keyword search index)
| Column | Type | Constraints |
|---|---|---|
| chunk_id | BIGSERIAL | PRIMARY KEY |
| version_id | INT | NOT NULL, FOREIGN KEY → DOCUMENT_VERSIONS, ON DELETE CASCADE |
| chunk_index | INT | NOT NULL, CHECK (chunk_index >= 0), **UNIQUE (version_id, chunk_index)** |
| mongo_chunk_id | VARCHAR(64) | NOT NULL, UNIQUE — readable chunk text lives in MongoDB |
| embedding | vector(384) | NOT NULL — `all-MiniLM-L6-v2`, normalized; HNSW index with `vector_cosine_ops` |
| tsv | tsvector | NOT NULL — lexemes only, from `to_tsvector('english', chunk text)`; GIN index |

Requires `CREATE EXTENSION vector;` and `CREATE EXTENSION pgcrypto;`.

## DOCUMENT_PERMISSIONS
| Column | Type | Constraints |
|---|---|---|
| doc_permission_id | SERIAL | PRIMARY KEY |
| document_id | INT | NOT NULL, FOREIGN KEY → DOCUMENTS, ON DELETE CASCADE |
| role_id | INT | NOT NULL, FOREIGN KEY → ROLES, ON DELETE CASCADE |
| access_level | VARCHAR(20) | NOT NULL, CHECK (access_level IN ('read','write','approve','admin')) |
| granted_by | INT | NOT NULL, FOREIGN KEY → USERS, ON DELETE RESTRICT |
| granted_at | TIMESTAMP | NOT NULL, DEFAULT now() |
| revoked_at | TIMESTAMP | NULL — set when access is revoked instead of deleting the row (audit trail) |
| | | **UNIQUE (document_id, role_id, access_level)** — prevents duplicate grants |

## ACCESS_LOGS (tamper-evident hash chain)
| Column | Type | Constraints |
|---|---|---|
| log_id | BIGSERIAL | PRIMARY KEY |
| user_id | INT | NOT NULL, FOREIGN KEY → USERS, ON DELETE RESTRICT (audit rows must never lose their actor) |
| document_id | INT | NOT NULL, FOREIGN KEY → DOCUMENTS, ON DELETE RESTRICT |
| version_id | INT | FOREIGN KEY → DOCUMENT_VERSIONS, ON DELETE RESTRICT |
| override_id | INT | FOREIGN KEY → ACCESS_OVERRIDES, NULL unless this was break-glass access |
| action | VARCHAR(20) | NOT NULL, CHECK (action IN ('view','download','upload','edit','approve')) |
| is_break_glass | BOOLEAN | NOT NULL, DEFAULT false, CHECK (is_break_glass = (override_id IS NOT NULL)) |
| ip_address | VARCHAR(45) | — |
| accessed_at | TIMESTAMP | NOT NULL, DEFAULT now() |
| prev_hash | CHAR(64) | NOT NULL — `row_hash` of the previous row; first row uses 64 zeros (genesis) |
| row_hash | CHAR(64) | NOT NULL, UNIQUE — SHA-256 over every other column of the row (see hash input below) |

**How the chain works**
- **Hash input:** `concat_ws('|', prev_hash, log_id, user_id, document_id, version_id, override_id, action, is_break_glass, ip_address, extract(epoch FROM accessed_at)::text)`. `concat_ws` skips NULLs (a plain `||` would turn the whole hash NULL when `version_id` or `override_id` is empty) and the delimiter prevents two different rows producing the same string. `extract(epoch ...)` makes the result independent of session timezone and DateStyle. Covering every column means flipping `is_break_glass` or editing `ip_address` is detected too.
- A `BEFORE INSERT` trigger fetches the latest `row_hash`, stores it as `prev_hash`, and computes `row_hash` with `pgcrypto`'s `digest(..., 'sha256')`. Defaults (including `log_id`) are applied before BEFORE triggers run, so `log_id` can be part of the hash.
- The trigger takes `pg_advisory_xact_lock(...)` first so two concurrent inserts cannot both claim the same predecessor.
- A `BEFORE UPDATE OR DELETE` trigger raises an exception, and the application role has `REVOKE UPDATE, DELETE`. Editing or removing a row therefore breaks the chain for every later row.
- `verify_audit_chain()` is a function that walks the table in `log_id` order, recomputes each hash, and returns the first mismatching `log_id` (or none). Results are stored in `AUDIT_INTEGRITY_CHECKS`.
- Indexed on `(document_id, accessed_at)`, `(user_id, accessed_at)`, and a partial index `WHERE is_break_glass`.

## AUDIT_INTEGRITY_CHECKS
| Column | Type | Constraints |
|---|---|---|
| check_id | SERIAL | PRIMARY KEY |
| run_by | INT | NOT NULL, FOREIGN KEY → USERS, ON DELETE RESTRICT |
| run_at | TIMESTAMP | NOT NULL, DEFAULT now() |
| rows_verified | BIGINT | NOT NULL, CHECK (rows_verified >= 0) |
| result | VARCHAR(10) | NOT NULL, CHECK (result IN ('intact','tampered')) |
| first_broken_log_id | BIGINT | NULL, CHECK ((result = 'tampered') = (first_broken_log_id IS NOT NULL)) |

## SEARCH_LOGS
| Column | Type | Constraints |
|---|---|---|
| search_id | BIGSERIAL | PRIMARY KEY |
| user_id | INT | NOT NULL, FOREIGN KEY → USERS, ON DELETE RESTRICT |
| query_text | TEXT | NOT NULL |
| search_type | VARCHAR(20) | NOT NULL, CHECK (search_type IN ('keyword','semantic','hybrid')) |
| results_count | INT | DEFAULT 0, CHECK (results_count >= 0) |
| searched_at | TIMESTAMP | NOT NULL, DEFAULT now() |

## SIMILAR_DOCUMENTS
| Column | Type | Constraints |
|---|---|---|
| similarity_id | SERIAL | PRIMARY KEY |
| document_id_1 | INT | NOT NULL, FOREIGN KEY → DOCUMENTS, ON DELETE CASCADE |
| document_id_2 | INT | NOT NULL, FOREIGN KEY → DOCUMENTS, ON DELETE CASCADE, CHECK (document_id_2 > document_id_1) — prevents duplicate/reversed pairs |
| similarity_score | FLOAT | NOT NULL, CHECK (similarity_score BETWEEN 0 AND 1) |
| detection_method | VARCHAR(30) | NOT NULL, DEFAULT 'vector_cosine' |
| detected_at | TIMESTAMP | NOT NULL, DEFAULT now() |
| | | **UNIQUE (document_id_1, document_id_2)** |

## NOTIFICATIONS
| Column | Type | Constraints |
|---|---|---|
| notification_id | BIGSERIAL | PRIMARY KEY |
| user_id | INT | NOT NULL, FOREIGN KEY → USERS, ON DELETE CASCADE |
| document_id | INT | FOREIGN KEY → DOCUMENTS, ON DELETE CASCADE |
| notification_type | VARCHAR(30) | NOT NULL, CHECK (notification_type IN ('expiry_warning','approval_needed','new_version','ack_required','ack_overdue','break_glass_review')) |
| message | TEXT | NOT NULL |
| is_read | BOOLEAN | NOT NULL, DEFAULT false |
| created_at | TIMESTAMP | NOT NULL, DEFAULT now() |

---

# Feature Tables

## Feature 1: Read-and-Acknowledge Tracking

### POLICY_ASSIGNMENTS
| Column | Type | Constraints |
|---|---|---|
| assignment_id | SERIAL | PRIMARY KEY |
| document_id | INT | NOT NULL, FOREIGN KEY → DOCUMENTS, ON DELETE CASCADE |
| target_role_id | INT | FOREIGN KEY → ROLES, ON DELETE CASCADE, nullable |
| target_department_id | INT | FOREIGN KEY → DEPARTMENTS, ON DELETE CASCADE, nullable |
| assigned_by | INT | NOT NULL, FOREIGN KEY → USERS, ON DELETE RESTRICT |
| assigned_at | TIMESTAMP | NOT NULL, DEFAULT now() |
| due_date | DATE | NOT NULL, CHECK (due_date >= assigned_at::date) |
| | | **CHECK (target_role_id IS NOT NULL OR target_department_id IS NOT NULL)** — at least one target |

### ACKNOWLEDGMENTS
| Column | Type | Constraints |
|---|---|---|
| ack_id | BIGSERIAL | PRIMARY KEY |
| assignment_id | INT | NOT NULL, FOREIGN KEY → POLICY_ASSIGNMENTS, ON DELETE CASCADE |
| user_id | INT | NOT NULL, FOREIGN KEY → USERS, ON DELETE CASCADE |
| version_id | INT | NOT NULL, FOREIGN KEY → DOCUMENT_VERSIONS, ON DELETE RESTRICT |
| acknowledged_at | TIMESTAMP | NOT NULL, DEFAULT now() |
| | | **UNIQUE (assignment_id, user_id, version_id)** — one acknowledgment per person per version |

Only *completed* acknowledgments are stored. "Pending" is computed: users in the targeted role/department with **no** matching row for the current approved version (a `LEFT JOIN ... WHERE ack_id IS NULL` anti-join). Because acknowledgments are tied to `version_id`, approving a new version automatically makes everyone pending again with no rows to delete. A trigger on `DOCUMENT_VERSIONS` (status → 'approved') inserts `ack_required` notifications for the assignees. Compliance % per department uses `GROUP BY department HAVING`.

## Feature 2: Regulatory Coverage and Gap Analysis

### REGULATIONS
| Column | Type | Constraints |
|---|---|---|
| regulation_id | SERIAL | PRIMARY KEY |
| regulation_name | VARCHAR(100) | NOT NULL, UNIQUE (e.g. NABH, JCI, HIPAA, DPDP Act) |
| issuing_body | VARCHAR(150) | NOT NULL |
| description | TEXT | — |

### CONTROLS
| Column | Type | Constraints |
|---|---|---|
| control_id | SERIAL | PRIMARY KEY |
| regulation_id | INT | NOT NULL, FOREIGN KEY → REGULATIONS, ON DELETE CASCADE |
| control_code | VARCHAR(30) | NOT NULL |
| title | VARCHAR(255) | NOT NULL |
| description | TEXT | — |
| is_mandatory | BOOLEAN | NOT NULL, DEFAULT true |
| | | **UNIQUE (regulation_id, control_code)** |

### DOCUMENT_CONTROL_MAP
| Column | Type | Constraints |
|---|---|---|
| document_id | INT | PRIMARY KEY (composite), FOREIGN KEY → DOCUMENTS, ON DELETE CASCADE |
| control_id | INT | PRIMARY KEY (composite), FOREIGN KEY → CONTROLS, ON DELETE CASCADE |
| mapped_by | INT | NOT NULL, FOREIGN KEY → USERS, ON DELETE RESTRICT |
| mapped_at | TIMESTAMP | NOT NULL, DEFAULT now() |

A control counts as **covered** only if it maps to at least one document with `document_status = 'active'` whose current version is `approved` and not past `expiry_date`. The view `v_control_coverage` returns, per control, the number of valid backing documents; a gap is any mandatory control with zero. The regulation-level coverage score is `COUNT(covered) / COUNT(mandatory)`. This is an anti-join (`LEFT JOIN ... IS NULL`), grouped by regulation.

## Feature 3: Break-Glass Emergency Access

### ACCESS_OVERRIDES
| Column | Type | Constraints |
|---|---|---|
| override_id | SERIAL | PRIMARY KEY |
| user_id | INT | NOT NULL, FOREIGN KEY → USERS, ON DELETE RESTRICT (the requester) |
| document_id | INT | NOT NULL, FOREIGN KEY → DOCUMENTS, ON DELETE RESTRICT |
| justification | TEXT | NOT NULL, **CHECK (char_length(trim(justification)) >= 20)** |
| granted_at | TIMESTAMP | NOT NULL, DEFAULT now() |
| expires_at | TIMESTAMP | NOT NULL, CHECK (expires_at > granted_at), CHECK (expires_at <= granted_at + interval '24 hours') |
| status | VARCHAR(10) | NOT NULL, DEFAULT 'active', CHECK (status IN ('active','expired','reviewed')) |
| reviewed_by | INT | FOREIGN KEY → USERS, ON DELETE RESTRICT, NULL until reviewed, CHECK (reviewed_by <> user_id) |
| reviewed_at | TIMESTAMP | NULL until reviewed |
| review_outcome | VARCHAR(15) | CHECK (review_outcome IN ('justified','unjustified')), NULL until reviewed |

**Behaviour**
- Requesting access runs as **one transaction**: insert into `ACCESS_OVERRIDES`, insert a flagged `ACCESS_LOGS` row, insert `break_glass_review` notifications for admins. If any step fails, none are kept.
- The permission-aware search and document-fetch queries treat a document as accessible if the user has role-based access **or** an `active` override with `expires_at > now()`.
- A scheduled job (or lazy check on read) flips `active` → `expired` after `expires_at`.
- View `v_break_glass_review_queue` lists unreviewed overrides for admins.

## Feature 4: Tamper-Evident Audit Log
Implemented through the `prev_hash` / `row_hash` columns on `ACCESS_LOGS` and the `AUDIT_INTEGRITY_CHECKS` table. See the ACCESS_LOGS section above.

## Feature 5: Document Dependency Graph

### DOCUMENT_REFERENCES
| Column | Type | Constraints |
|---|---|---|
| reference_id | SERIAL | PRIMARY KEY |
| source_document_id | INT | NOT NULL, FOREIGN KEY → DOCUMENTS, ON DELETE CASCADE |
| target_document_id | INT | NOT NULL, FOREIGN KEY → DOCUMENTS, ON DELETE CASCADE |
| reference_type | VARCHAR(15) | NOT NULL, DEFAULT 'cites', CHECK (reference_type IN ('cites','depends_on','supersedes')) |
| created_at | TIMESTAMP | NOT NULL, DEFAULT now() |
| | | **CHECK (source_document_id <> target_document_id)**, **UNIQUE (source_document_id, target_document_id, reference_type)** |

**Impact analysis** ("if I retire document X, what is affected?") uses a `WITH RECURSIVE` CTE that starts at X and walks `target_document_id → source_document_id` edges, tracking depth and the visited path (`ARRAY[...]`) so that **cycles are detected and stopped** (`WHERE NOT next_id = ANY(path)`). Index both `source_document_id` and `target_document_id`. A trigger on `DOCUMENTS` (status → 'retired') can raise a warning notification to the owners of every dependent document.

---

# Triggers, Functions, Views and Indexes

## Triggers
| Trigger | Fires on | Purpose |
|---|---|---|
| trg_documents_updated_at | BEFORE UPDATE on DOCUMENTS | Sets `updated_at = now()` |
| trg_version_transition | BEFORE UPDATE on DOCUMENT_VERSIONS | Allows only pending_review → approved, approved → superseded or expired, pending_review → expired; rejects any other status change; stamps `approved_at` |
| trg_version_approved | AFTER UPDATE (status becomes approved) | Marks the previous approved version superseded, sets `documents.current_version_id`, inserts `new_version` and `ack_required` notifications for assignees |
| trg_version_expired | AFTER UPDATE (status becomes expired) | Notifies the document owner |
| trg_audit_chain | BEFORE INSERT on ACCESS_LOGS | Computes `prev_hash` and `row_hash` under an advisory lock |
| trg_audit_immutable | BEFORE UPDATE OR DELETE on ACCESS_LOGS | Raises an exception: audit rows are insert-only |
| trg_document_retired | AFTER UPDATE (status becomes retired) | Uses the dependency CTE to notify owners of dependent documents |

Triggers react to row changes only. Anything driven by the passage of time (expiry warnings, override expiry) is a function called by a scheduler, below.

## Functions
| Function | Purpose |
|---|---|
| verify_audit_chain() | Recomputes every hash in `log_id` order; returns the first broken `log_id` or NULL |
| fn_expiry_sweep() | Called nightly: marks past-expiry versions expired (which fires trg_version_expired) and inserts `expiry_warning` notifications at 30 and 7 days, skipping duplicates |
| fn_expire_overrides() | Called every few minutes: sets `active` overrides past `expires_at` to `expired` |
| fn_control_coverage_score(regulation_id) | Share of mandatory controls backed by a valid document |

## Views
`v_document_status_summary`, `v_expiring_soon`, `v_access_activity`, `v_ack_compliance`, `v_control_coverage`, `v_break_glass_review_queue`.

## Indexes (beyond primary keys and UNIQUE constraints)
| Table | Index | Reason |
|---|---|---|
| USERS | (role_id), (department_id) | Joins and department reports |
| DOCUMENTS | (category_id), (owner_id), (document_status) | Filtering and dashboards |
| DOCUMENT_VERSIONS | (version_status); partial (expiry_date) WHERE version_status = 'approved' | Expiry tracking |
| DOCUMENT_PERMISSIONS | partial (document_id, role_id) WHERE revoked_at IS NULL | Permission-aware search filter |
| ACCESS_LOGS | (document_id, accessed_at), (user_id, accessed_at); partial (accessed_at) WHERE is_break_glass | Audit queries |
| SEARCH_LOGS | (user_id, searched_at) | Per-user history |
| NOTIFICATIONS | (user_id, is_read, created_at) | Unread badge |
| POLICY_ASSIGNMENTS / ACKNOWLEDGMENTS | (document_id); (user_id, version_id) | Pending-acknowledgment anti-join |
| DOCUMENT_CONTROL_MAP | (control_id) | Coverage view |
| ACCESS_OVERRIDES | partial (user_id, document_id) WHERE status = 'active' | Search access check |
| DOCUMENT_REFERENCES | (source_document_id), (target_document_id) | Recursive impact CTE, both directions |
| DOCUMENT_CHUNKS | HNSW on `embedding` (`vector_cosine_ops`); GIN on `tsv` | Vector and keyword search |

## Deletion policy
Documents and versions that have audit rows can never be hard-deleted, because `ACCESS_LOGS` references them with `ON DELETE RESTRICT`. Retire a document (`document_status = 'retired'`) or supersede a version instead. Hard DELETE is used only for link and housekeeping rows (dependency links, role permissions, withdrawn assignments, old read notifications).

---

## Notes on the circular FK (DOCUMENTS ↔ DOCUMENT_VERSIONS)
`DOCUMENTS.current_version_id` references `DOCUMENT_VERSIONS`, which itself
references `DOCUMENTS.document_id`. Handle this in DDL by:
1. Creating `DOCUMENTS` first with `current_version_id` nullable and **no**
   FK constraint yet.
2. Creating `DOCUMENT_VERSIONS` with its FK to `DOCUMENTS`.
3. Adding the FK on `DOCUMENTS.current_version_id` afterward via `ALTER TABLE`.

This also satisfies the rubric's requirement to demonstrate `CREATE`, `ALTER`,
and appropriate constraint usage together.
