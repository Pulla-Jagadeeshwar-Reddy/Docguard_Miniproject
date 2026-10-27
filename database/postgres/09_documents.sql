-- The API checks for duplicate checksums before ingesting, but concurrent uploads
-- can race; this unique index makes PostgreSQL the final duplicate guard.
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_versions_checksum ON document_versions(checksum);
