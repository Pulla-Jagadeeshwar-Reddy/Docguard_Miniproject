-- Push-owned indexes. HNSW supports cosine-distance nearest-neighbour search.
CREATE INDEX idx_search_logs_user_time ON search_logs(user_id, searched_at DESC);
CREATE INDEX idx_search_logs_type_time ON search_logs(search_type, searched_at DESC);
CREATE INDEX idx_similar_documents_second ON similar_documents(document_id_2);
CREATE INDEX idx_document_chunks_version ON document_chunks(version_id, chunk_index);
CREATE INDEX idx_document_chunks_embedding ON document_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_document_chunks_tsv ON document_chunks USING gin (tsv);
CREATE INDEX idx_policy_assignments_document ON policy_assignments(document_id);
CREATE INDEX idx_policy_assignments_role_due ON policy_assignments(target_role_id, due_date);
CREATE INDEX idx_policy_assignments_department_due ON policy_assignments(target_department_id, due_date);
CREATE UNIQUE INDEX uq_policy_assignment_target
  ON policy_assignments (
    document_id,
    COALESCE(target_role_id, 0),
    COALESCE(target_department_id, 0)
  );
CREATE INDEX idx_acknowledgments_user_version ON acknowledgments(user_id, version_id);
CREATE INDEX idx_acknowledgments_assignment ON acknowledgments(assignment_id);
CREATE INDEX idx_controls_regulation_mandatory ON controls(regulation_id, is_mandatory);
CREATE INDEX idx_document_control_map_control ON document_control_map(control_id, document_id);
