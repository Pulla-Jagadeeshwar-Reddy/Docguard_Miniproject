# Important SQL and MongoDB queries

All statements below are parameterized examples for the DocuGuard PostgreSQL schema. User-facing search and reads apply the caller's access rules before returning document content.

## Permission-filtered hybrid search

The API combines two ranked chunk sets with reciprocal-rank fusion. The shortened example shows the permission boundary and ranking expression; the implementation also filters to active documents with an approved, unexpired current version and fetches the selected snippet from MongoDB.

```sql
WITH permitted AS (
  SELECT d.document_id, d.current_version_id AS version_id
  FROM documents d
  JOIN document_versions v ON v.version_id = d.current_version_id
  JOIN fn_accessible_document_ids($1) a USING (document_id)
  WHERE d.document_status = 'active'
    AND v.version_status = 'approved'
    AND (v.expiry_date IS NULL OR v.expiry_date >= CURRENT_DATE)
), vector_ranked AS (
  SELECT p.document_id, c.mongo_chunk_id,
         row_number() OVER (ORDER BY c.embedding <=> $2::vector) AS rank
  FROM permitted p JOIN document_chunks c USING (version_id)
), keyword_ranked AS (
  SELECT p.document_id, c.mongo_chunk_id,
         row_number() OVER (
           ORDER BY ts_rank_cd(c.tsv, websearch_to_tsquery('english', $3)) DESC
         ) AS rank
  FROM permitted p JOIN document_chunks c USING (version_id)
  WHERE c.tsv @@ websearch_to_tsquery('english', $3)
)
SELECT document_id, mongo_chunk_id,
       sum(1.0 / (60 + rank)) AS rrf_score
FROM (
  SELECT document_id, mongo_chunk_id, rank FROM vector_ranked WHERE rank <= 100
  UNION ALL
  SELECT document_id, mongo_chunk_id, rank FROM keyword_ranked WHERE rank <= 100
) ranked
GROUP BY document_id, mongo_chunk_id
ORDER BY rrf_score DESC
LIMIT 50;
```

The API's mode toggle omits one rank source for keyword-only or semantic-only requests. Category filtering is also parameterized.

## Pending acknowledgment anti-join

```sql
SELECT pa.assignment_id, d.title, u.user_id, u.full_name, v.version_number, pa.due_date
FROM policy_assignments pa
JOIN documents d ON d.document_id = pa.document_id
JOIN document_versions v ON v.version_id = d.current_version_id
JOIN users u ON u.account_status = 'active'
  AND (pa.target_role_id IS NULL OR pa.target_role_id = u.role_id)
  AND (pa.target_department_id IS NULL OR pa.target_department_id = u.department_id)
LEFT JOIN acknowledgments a ON a.assignment_id = pa.assignment_id
  AND a.user_id = u.user_id AND a.version_id = v.version_id
WHERE a.ack_id IS NULL
  AND d.document_status = 'active'
  AND v.version_status = 'approved'
  AND (v.expiry_date IS NULL OR v.expiry_date >= CURRENT_DATE);
```

The current version id is part of the join. An acknowledgment of version 1 cannot satisfy an assignment after version 2 becomes current.

## Departments below 80% completion

```sql
SELECT department_name, eligible_assignments, acknowledged_assignments,
       pending_assignments, completion_percent
FROM v_ack_compliance_by_department
GROUP BY department_name, eligible_assignments, acknowledged_assignments,
         pending_assignments, completion_percent
HAVING completion_percent < 80
ORDER BY completion_percent, department_name;
```

## Mandatory regulatory gaps

```sql
SELECT regulation_name, control_code, control_title, mapped_document_count,
       valid_document_count
FROM v_control_coverage
WHERE is_mandatory
  AND NOT is_covered
ORDER BY regulation_name, control_code;
```

The view counts only mappings whose document is active and whose current version is approved and unexpired. The Phase 6 SQL test checks that an expired-only mapping remains a gap.

## Window-function examples

Rank users by download volume:

```sql
SELECT user_id, full_name, downloads,
       dense_rank() OVER (ORDER BY downloads DESC) AS download_rank
FROM (
  SELECT u.user_id, u.full_name, count(*) AS downloads
  FROM users u JOIN access_logs a ON a.user_id = u.user_id
  WHERE a.action = 'download'
  GROUP BY u.user_id, u.full_name
) totals
ORDER BY download_rank, full_name;
```

Flag consecutive off-hours activity bursts:

```sql
WITH events AS (
  SELECT user_id, accessed_at,
         lag(accessed_at) OVER (PARTITION BY user_id ORDER BY accessed_at) AS previous_at
  FROM access_logs
  WHERE EXTRACT(HOUR FROM accessed_at) < 6 OR EXTRACT(HOUR FROM accessed_at) >= 22
)
SELECT user_id, accessed_at, previous_at
FROM events
WHERE previous_at IS NOT NULL
  AND accessed_at - previous_at <= interval '10 minutes'
ORDER BY user_id, accessed_at;
```

These are audit-review prompts, not an automated anomaly verdict.

## MongoDB keyword analytics

The Admin analytics endpoint first obtains the eligible current approved version ids from PostgreSQL, then runs a `$facet` over those ids in MongoDB:

```javascript
[
  { $match: { versionId: { $in: approvedVersionIds } } },
  { $facet: {
    topKeywords: [
      { $unwind: '$extracted.keywords' },
      { $group: { _id: { category: '$category', keyword: '$extracted.keywords' }, count: { $sum: 1 } } },
      { $sort: { count: -1, '_id.category': 1 } },
      { $limit: 12 }
    ],
    categories: [
      { $group: { _id: '$category', policies: { $sum: 1 }, words: { $sum: '$extracted.wordCount' } } }
    ]
  } }
]
```
