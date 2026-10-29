# MongoDB and vector search design

DocuGuard uses PostgreSQL as the authority for users, access, versions, assignments, regulations, and audit data. MongoDB stores the extracted page text and variable-shape extraction metadata. pgvector lives inside PostgreSQL so retrieval can apply the SQL permission filter before ranking chunks.

## MongoDB collections

### `document_contents`

One record per extracted document version. Typical fields:

```javascript
{
  _id: "mongo-content-uuid",
  mongoDocId: "stable-document-reference",
  documentId: 42,
  versionId: 103,
  category: "Infection Control",
  title: "Standard Precautions and Sharps Injury Response",
  fileName: "policy.pdf",
  mimeType: "application/pdf",
  pageCount: 4,
  pages: [{ n: 1, text: "..." }],
  sections: [{ heading: "Sharps injury response", level: 2, pageStart: 2, lineStart: 31 }],
  extracted: {
    keywords: ["sharps", "puncture-resistant", "occupational-health"],
    wordCount: 920,
    language: "en",
    tables: [],
    datesMentioned: []
  },
  createdAt: ISODate("2026-10-29T00:00:00Z")
}
```

`pages`, `sections`, and `extracted` can grow to support varying document structure without adding nullable SQL columns. The version/document ids link back to PostgreSQL; they are not authorization claims.

### `document_chunks`

Text is split into 300-word chunks with a 50-word overlap. Each chunk stores `contentId`, `documentId`, `versionId`, `chunkIndex`, `heading`, `page`, `text`, and `tokenCount`. Chunk text remains in MongoDB; PostgreSQL stores the corresponding Mongo `_id` in `document_chunks.mongo_chunk_id`.

## Indexes

- `document_contents`: a unique partial index on numeric `versionId` for linked versions, document/category, extracted keywords, category, and creation time.
- `document_chunks`: a unique partial index on `(versionId, chunkIndex)`, plus document/version and heading indexes.
- Partial unique indexes exclude unlinked in-flight records (`versionId: null`) so two uploads can be prepared before PostgreSQL assigns their version ids.
- `database/mongo/indexes.js` upgrades the earlier unconditional unique-index definitions before creating the new indexes.

## PostgreSQL vector and full-text storage

The local `Xenova/all-MiniLM-L6-v2` feature-extraction pipeline produces normalized 384-dimensional vectors. `document_chunks.embedding` stores `vector(384)` and `document_chunks.tsv` stores English lexemes generated from the same chunk. A vector HNSW index supports cosine distance, while a GIN index supports full-text matching.

```sql
SELECT version_id, chunk_index, mongo_chunk_id,
       embedding <=> $1::vector AS cosine_distance,
       ts_rank_cd(tsv, websearch_to_tsquery('english', $2)) AS text_rank
FROM document_chunks
WHERE embedding <=> $1::vector < 0.45
   OR tsv @@ websearch_to_tsquery('english', $2)
ORDER BY embedding <=> $1::vector
LIMIT 50;
```

The live API wraps this retrieval in a permission-filtered candidate CTE and supports keyword-only, semantic-only, and hybrid modes. Hybrid search uses reciprocal-rank fusion: `score = sum(1 / (60 + rank))` across vector and keyword rankings. Query text is embedded with the same model as chunks. MongoDB is queried only for the winning chunk ids after the SQL permission filter has run.

## MongoDB aggregations

Admin keyword analytics uses `$match` on approved PostgreSQL version ids, then `$facet` branches for keyword frequency (`$unwind` and `$group`), category totals, and longest policy text. The same reusable example pipelines are in `database/mongo/aggregations.js`.

## Lifecycle, recovery, and limits

- Upload extracts PDF or DOCX text and writes Mongo content before the PostgreSQL transaction commits. It then links Mongo ids to the SQL document/version ids within the transaction. A failed upload deletes the Mongo content and chunks as compensation.
- An orphan sweep runs after a one-hour grace period, then every six hours, and deletes aged Mongo content with no matching PostgreSQL version.
- The model downloads to the Transformers.js cache on first use. Set `HF_HOME` to choose another cache directory. Once the model is cached, inference runs locally on CPU.
- Scanned PDFs need OCR, which is out of scope. Search retrieves source snippets; it does not generate answers or citations with an LLM.
- Supplied policies and regulation/control mappings are fictional or illustrative. This is not a clinical or compliance decision system.
