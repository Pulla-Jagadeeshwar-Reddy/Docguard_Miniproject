# Push — Phase 2 ingestion and embeddings

Phase 2 replaces the upload-time ingestion stub with PDF/DOCX extraction, MongoDB persistence, compensating deletion, orphan cleanup, and local vector embeddings.

## Runtime behavior

- The document upload flow extracts text from PDFs with PDF.js and DOCX files with Mammoth. Scanned-image OCR is not included.
- MongoDB stores one extracted-content record per version, page text, detected section headings, keyword counts, and 300-word overlapping chunks (50-word overlap).
- Once PostgreSQL has created the document and version rows, the service links the Mongo records to those ids while the upload transaction is still open. If any step fails, the upload route rolls back PostgreSQL and calls `deleteIngested` to remove Mongo content and chunks.
- The local `Xenova/all-MiniLM-L6-v2` model creates normalized 384-value embeddings. PostgreSQL stores those vectors in `document_chunks.embedding` and English full-text vectors in `document_chunks.tsv`.
- Embedding writes replace a version's prior SQL chunk rows in one transaction. Upload schedules indexing after commit, and approval refreshes the approved version's embeddings.
- A six-hour Mongo orphan sweep removes content older than one hour that has no matching PostgreSQL version. This handles failed compensating deletes without racing an active upload.
- Mongo unique indexes include only linked numeric version ids, so concurrently prepared uploads with an unlinked `versionId: null` do not collide. `npm run db:mongo:indexes` upgrades the old index definitions safely.

## Model setup

`EMBEDDING_MODEL` defaults to `Xenova/all-MiniLM-L6-v2`. Transformers.js downloads model files on first use and caches them for later runs. Set `HF_HOME` if the machine needs a custom model cache directory. The embedding worker is CPU-based by default; first-time model download and inference can add latency to an upload or approval request.

## Integration checks

Build the backend with `npm run build --workspace backend`. To exercise the complete upload, compensation, and vector path, run the API integration suite against the dedicated local PostgreSQL and MongoDB databases after applying migrations and creating Mongo indexes. Rebuild only a disposable project database.
