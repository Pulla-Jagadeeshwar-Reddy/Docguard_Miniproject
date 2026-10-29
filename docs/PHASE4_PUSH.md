# Push — Phase 4 search UI and keyword analytics

- The protected `/search` page provides a query field, keyword/semantic/hybrid selector, category filter, result snippets, mode labels, and links to permitted policy details.
- Document details now show a related-policies panel based on the permission-filtered similarity endpoint.
- `GET /api/analytics/keywords` is Admin-only. Its MongoDB `$facet` aggregates approved current policy text into keyword counts by category, category totals, and longest indexed policies.
- The dashboard shows the most frequent indexed terms for Admins. Other roles do not request this analytics endpoint.
- The document detail page reports ingestion pending when its selected version has no PostgreSQL chunks, and clears the status once indexing completes.

## Verification

`npm run lint --workspace frontend` and `npm run build --workspace backend` compile the Phase 4 UI and API. Integration scenarios for search permissions and the Admin-only analytics response are in `backend/test/search.test.mjs`; run the API suite against the seeded local databases to exercise them.
