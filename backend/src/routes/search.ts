import { Router } from "express";
import { z } from "zod";
import { pgPool, mongoClient } from "../config/databases.js";
import { env } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";
import { embedText } from "../services/ingest.js";

const router = Router();
const searchSchema = z.object({
  q: z.string().trim().min(1).max(200),
  type: z.enum(["keyword", "semantic", "hybrid"]).default("hybrid"),
  categoryId: z.coerce.number().int().positive().optional()
});

type SearchRow = {
  documentId: number;
  title: string;
  category: string;
  versionId: number;
  versionNumber: number;
  effectiveDate: string;
  score: number;
  mongoChunkId: string;
  matchedBy: string;
};
type SearchChunk = { _id: string; text?: string };

router.get("/", requireAuth, async (request, response, next) => {
  const parsed = searchSchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid search query", issues: parsed.error.issues.map(issue => issue.path.join(".")) });
    return;
  }
  const { q, type, categoryId } = parsed.data;
  try {
    const vector = type === "keyword" ? null : `[${(await embedText(q)).join(",")}]`;
    const result = await pgPool.query(
      `WITH permitted AS (
         SELECT d.document_id, d.title, dc.category_name AS category,
                v.version_id, v.version_number, v.effective_date
         FROM documents d
         JOIN document_categories dc ON dc.category_id = d.category_id
         JOIN document_versions v ON v.version_id = d.current_version_id AND v.document_id = d.document_id
         JOIN fn_accessible_document_ids($1) a ON a.document_id = d.document_id
         WHERE d.document_status = 'active' AND v.version_status = 'approved'
           AND (v.expiry_date IS NULL OR v.expiry_date >= CURRENT_DATE)
           AND ($2::int IS NULL OR dc.category_id = $2)
       ), vector_ranked AS (
         SELECT p.document_id, p.version_id, c.mongo_chunk_id,
                row_number() OVER (ORDER BY c.embedding <=> $3::vector, p.document_id, c.chunk_index) AS rank
         FROM permitted p JOIN document_chunks c ON c.version_id = p.version_id
         WHERE $4::boolean AND c.embedding IS NOT NULL
       ), keyword_ranked AS (
         SELECT p.document_id, p.version_id, c.mongo_chunk_id,
                row_number() OVER (ORDER BY ts_rank_cd(c.tsv, websearch_to_tsquery('english', $5)) DESC, p.document_id, c.chunk_index) AS rank
         FROM permitted p JOIN document_chunks c ON c.version_id = p.version_id
         WHERE $6::boolean AND c.tsv @@ websearch_to_tsquery('english', $5)
       ), fused AS (
         SELECT document_id, version_id, mongo_chunk_id,
                sum(contribution)::float8 AS score, string_agg(DISTINCT source, ',') AS matched_by
         FROM (
           SELECT document_id, version_id, mongo_chunk_id, 1.0 / (60 + rank) AS contribution, 'semantic'::text AS source
           FROM vector_ranked WHERE rank <= 100
           UNION ALL
           SELECT document_id, version_id, mongo_chunk_id, 1.0 / (60 + rank), 'keyword'::text
           FROM keyword_ranked WHERE rank <= 100
         ) ranked
         GROUP BY document_id, version_id, mongo_chunk_id
       )
       SELECT DISTINCT ON (f.document_id)
              p.document_id AS "documentId", p.title, p.category,
              p.version_id AS "versionId", p.version_number AS "versionNumber",
              p.effective_date AS "effectiveDate", f.score,
              f.mongo_chunk_id AS "mongoChunkId", f.matched_by AS "matchedBy"
       FROM fused f JOIN permitted p ON p.document_id = f.document_id AND p.version_id = f.version_id
       ORDER BY f.document_id, f.score DESC, f.mongo_chunk_id
       LIMIT 50`,
      [request.user!.id, categoryId ?? null, vector, type !== "keyword", q, type !== "semantic"]
    );
    const rows = result.rows as SearchRow[];
    const snippets = new Map<string, string>();
    if (rows.length) {
      await mongoClient.connect();
      const chunks = await mongoClient.db(env.mongoDb).collection<SearchChunk>("document_chunks").find(
        { _id: { $in: rows.map(row => row.mongoChunkId) } },
        { projection: { _id: 1, text: 1 } }
      ).toArray();
      for (const chunk of chunks) snippets.set(String(chunk._id), String(chunk.text ?? ""));
    }
    const results = rows.map(row => ({
      documentId: row.documentId,
      title: row.title,
      category: row.category,
      versionId: row.versionId,
      versionNumber: row.versionNumber,
      effectiveDate: row.effectiveDate,
      score: Number(row.score),
      matchedBy: row.matchedBy.split(",").sort(),
      snippet: snippets.get(row.mongoChunkId)?.slice(0, 520) ?? ""
    }));
    await pgPool.query(
      `INSERT INTO search_logs(user_id, query_text, search_type, results_count)
       VALUES ($1, $2, $3, $4)`,
      [request.user!.id, q, type, results.length]
    );
    response.json({ query: q, type, count: results.length, results });
  } catch (error) { next(error); }
});

export { router as searchRouter };
