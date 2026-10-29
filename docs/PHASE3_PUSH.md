# Push — Phase 3 hybrid search and similar policies

## Search API

`GET /api/search?q=...&type=keyword|semantic|hybrid&categoryId=...` now supports three modes. The default is `hybrid`.

- Every candidate set starts with `fn_accessible_document_ids(user_id)` and requires an active document with an approved, unexpired current version.
- Keyword mode ranks PostgreSQL English full-text chunks. Semantic mode embeds the query with the same local 384-dimensional model used for document chunks. Hybrid mode combines both ranked lists using reciprocal-rank fusion.
- The endpoint returns a short MongoDB chunk snippet, matched mode(s), and rank-fusion score, then appends a `search_logs` row.
- Category and query values are validated and passed as SQL parameters. Restricted document text never enters the candidate list or snippet lookup.

## Similar policies

`GET /api/documents/:id/similar` returns up to ten currently approved and accessible related policies. A background job averages each current version's chunk vectors and stores document-level cosine similarity pairs in `similar_documents`; approval refreshes the cache immediately, and the job also runs at API start and every 24 hours. Scores below 0.15 are omitted.

## Seeded search data

For the three synthetic policy examples, run:

```powershell
npm run db:mongo:indexes
npm run db:mongo:seed
npm run db:embeddings
```

SQL migrations must run first. The embedding command processes approved versions with Mongo chunks that do not yet have PostgreSQL vectors. The Transformers.js model downloads on first use and then uses its local cache.
