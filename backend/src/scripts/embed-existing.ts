import { mongoClient, pgPool } from "../config/databases.js";
import { queueEmbedding } from "../services/ingest.js";

try {
  const versions = await pgPool.query(
    `SELECT v.version_id
     FROM documents d JOIN document_versions v ON v.version_id = d.current_version_id
     WHERE d.document_status = 'active' AND v.version_status = 'approved'
       AND (v.expiry_date IS NULL OR v.expiry_date >= CURRENT_DATE)
     ORDER BY v.version_id`
  );
  let indexed = 0;
  for (const { version_id: versionId } of versions.rows) {
    const existing = await pgPool.query("SELECT 1 FROM document_chunks WHERE version_id = $1 LIMIT 1", [versionId]);
    if (existing.rowCount) continue;
    try {
      await queueEmbedding(versionId);
      indexed += 1;
      console.log(`Embedded version ${versionId}.`);
    } catch (error) {
      console.warn(`Skipped version ${versionId}: ${error instanceof Error ? error.message : "no content available"}`);
    }
  }
  console.log(`Embedded ${indexed} approved version(s).`);
} finally {
  await pgPool.end();
  await mongoClient.close();
}
