-- Push-owned tables for search, acknowledgments and regulatory coverage.
-- Runs after 01a_schema_core.sql and before 02_alter.sql.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE search_logs (
  search_id BIGSERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  query_text TEXT NOT NULL CHECK (char_length(trim(query_text)) BETWEEN 1 AND 2000),
  search_type VARCHAR(20) NOT NULL CHECK (search_type IN ('keyword', 'semantic', 'hybrid')),
  results_count INT NOT NULL DEFAULT 0 CHECK (results_count >= 0),
  searched_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE similar_documents (
  similarity_id BIGSERIAL PRIMARY KEY,
  document_id_1 INT NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
  document_id_2 INT NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
  similarity_score NUMERIC(5,4) NOT NULL CHECK (similarity_score BETWEEN 0 AND 1),
  detection_method VARCHAR(30) NOT NULL DEFAULT 'vector_cosine',
  detected_at TIMESTAMP NOT NULL DEFAULT now(),
  CHECK (document_id_1 < document_id_2),
  UNIQUE (document_id_1, document_id_2)
);

-- A row is written after the local embedding worker has produced a vector.
-- Human-readable text remains in MongoDB; tsv stores lexemes only.
CREATE TABLE document_chunks (
  chunk_id BIGSERIAL PRIMARY KEY,
  version_id INT NOT NULL REFERENCES document_versions(version_id) ON DELETE CASCADE,
  chunk_index INT NOT NULL CHECK (chunk_index >= 0),
  mongo_chunk_id VARCHAR(64) NOT NULL UNIQUE,
  embedding vector(384) NOT NULL,
  tsv tsvector NOT NULL,
  UNIQUE (version_id, chunk_index)
);

CREATE TABLE policy_assignments (
  assignment_id SERIAL PRIMARY KEY,
  document_id INT NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
  target_role_id INT REFERENCES roles(role_id) ON DELETE CASCADE,
  target_department_id INT REFERENCES departments(department_id) ON DELETE CASCADE,
  assigned_by INT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  assigned_at TIMESTAMP NOT NULL DEFAULT now(),
  due_date DATE NOT NULL,
  CHECK (target_role_id IS NOT NULL OR target_department_id IS NOT NULL),
  CHECK (due_date >= assigned_at::date)
);

CREATE TABLE acknowledgments (
  ack_id BIGSERIAL PRIMARY KEY,
  assignment_id INT NOT NULL REFERENCES policy_assignments(assignment_id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  version_id INT NOT NULL REFERENCES document_versions(version_id) ON DELETE RESTRICT,
  acknowledged_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, user_id, version_id)
);

CREATE TABLE regulations (
  regulation_id SERIAL PRIMARY KEY,
  regulation_name VARCHAR(100) NOT NULL UNIQUE,
  issuing_body VARCHAR(150) NOT NULL,
  description TEXT
);

CREATE TABLE controls (
  control_id SERIAL PRIMARY KEY,
  regulation_id INT NOT NULL REFERENCES regulations(regulation_id) ON DELETE CASCADE,
  control_code VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  is_mandatory BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (regulation_id, control_code)
);

CREATE TABLE document_control_map (
  document_id INT NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
  control_id INT NOT NULL REFERENCES controls(control_id) ON DELETE CASCADE,
  mapped_by INT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  mapped_at TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, control_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON
  search_logs, similar_documents, document_chunks, policy_assignments,
  acknowledgments, regulations, controls, document_control_map
TO docuguard_runtime;
GRANT USAGE, SELECT ON SEQUENCE
  search_logs_search_id_seq, similar_documents_similarity_id_seq,
  document_chunks_chunk_id_seq, policy_assignments_assignment_id_seq,
  acknowledgments_ack_id_seq, regulations_regulation_id_seq, controls_control_id_seq
TO docuguard_runtime;
