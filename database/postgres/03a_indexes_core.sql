CREATE INDEX idx_users_role_id ON users(role_id);
CREATE INDEX idx_users_department_id ON users(department_id);

CREATE INDEX idx_documents_category_id ON documents(category_id);
CREATE INDEX idx_documents_owner_id ON documents(owner_id);
CREATE INDEX idx_documents_status ON documents(document_status);
CREATE INDEX idx_documents_current_version_id ON documents(current_version_id);

CREATE INDEX idx_document_versions_status ON document_versions(version_status);
CREATE INDEX idx_document_versions_expiry_approved
  ON document_versions(expiry_date)
  WHERE version_status = 'approved';

CREATE INDEX idx_document_permissions_active
  ON document_permissions(document_id, role_id)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_access_logs_document_time ON access_logs(document_id, accessed_at);
CREATE INDEX idx_access_logs_user_time ON access_logs(user_id, accessed_at);
CREATE INDEX idx_access_logs_break_glass_time ON access_logs(accessed_at)
  WHERE is_break_glass;

CREATE INDEX idx_notifications_user_read_created
  ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX idx_access_overrides_active_user_document
  ON access_overrides(user_id, document_id)
  WHERE status = 'active';

CREATE INDEX idx_document_references_source ON document_references(source_document_id);
CREATE INDEX idx_document_references_target ON document_references(target_document_id);
