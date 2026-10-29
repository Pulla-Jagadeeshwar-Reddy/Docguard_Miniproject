import { pgPool } from "../config/databases.js";

/** Refresh the undirected document-level similarity cache from current approved versions. */
export async function rebuildSimilarDocuments(): Promise<number> {
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM similar_documents");
    const result = await client.query(
      `WITH doc_vectors AS (
         SELECT d.document_id, avg(c.embedding) AS embedding
         FROM documents d
         JOIN document_versions v ON v.version_id = d.current_version_id
         JOIN document_chunks c ON c.version_id = v.version_id
         WHERE d.document_status = 'active' AND v.version_status = 'approved'
           AND (v.expiry_date IS NULL OR v.expiry_date >= CURRENT_DATE)
         GROUP BY d.document_id
       )
       INSERT INTO similar_documents(document_id_1, document_id_2, similarity_score, detection_method)
       SELECT a.document_id, b.document_id,
              greatest(0, least(1, 1 - (a.embedding <=> b.embedding)))::numeric(5,4),
              'vector_cosine'
       FROM doc_vectors a JOIN doc_vectors b ON a.document_id < b.document_id
       WHERE 1 - (a.embedding <=> b.embedding) >= 0.15
       ON CONFLICT (document_id_1, document_id_2) DO UPDATE
         SET similarity_score = EXCLUDED.similarity_score,
             detection_method = EXCLUDED.detection_method,
             detected_at = now()`
    );
    await client.query("COMMIT");
    return result.rowCount ?? 0;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export function scheduleSimilarDocumentRebuild(): void {
  const run = () => {
    void rebuildSimilarDocuments().catch(() => console.warn("DocuGuard similarity refresh failed; it will retry later"));
  };
  run();
  setInterval(run, 24 * 60 * 60 * 1000).unref();
}
