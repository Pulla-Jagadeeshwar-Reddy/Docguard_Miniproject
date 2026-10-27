-- Close the documents <-> document_versions cycle only after both tables exist.
ALTER TABLE documents
  ADD CONSTRAINT fk_documents_current_version
  FOREIGN KEY (current_version_id)
  REFERENCES document_versions(version_id)
  ON DELETE NO ACTION;
