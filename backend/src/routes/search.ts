import { Router } from "express";
import { z } from "zod";
import { pgPool, mongoClient } from "../config/databases.js";
import { env } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

const searchSchema = z.object({
  q: z.string().trim().min(1).max(200),
  type: z.enum(["keyword"]).default("keyword")
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

router.get("/", requireAuth, async (request, response, next) => {
  const parsed = searchSchema.safeParse(request.query);

  if (!parsed.success) {
    response.status(400).json({
      error: "Invalid search query",
      issues: parsed.error.issues.map(issue => issue.path.join("."))
    });
    return;
  }

  try {
    const userId = request.user!.id;
    const query = parsed.data.q;
    const regex = escapeRegex(query);

    // Restrict candidates in PostgreSQL before searching MongoDB.
    const accessible = await pgPool.query(
      `SELECT
         d.document_id AS "documentId",
         d.title,
         dc.category_name AS category,
         v.version_id AS "versionId",
         v.version_number AS "versionNumber",
         v.effective_date AS "effectiveDate"
       FROM documents d
       JOIN document_categories dc ON dc.category_id = d.category_id
       JOIN document_versions v
         ON v.version_id = d.current_version_id
        AND v.document_id = d.document_id
       JOIN fn_accessible_document_ids($1) a
         ON a.document_id = d.document_id
       WHERE d.document_status = 'active'
         AND v.version_status = 'approved'
         AND (v.expiry_date IS NULL OR v.expiry_date >= CURRENT_DATE)
       ORDER BY d.title`,
      [userId]
    );

    const candidates = accessible.rows as Array<{
      documentId: number;
      title: string;
      category: string;
      versionId: number;
      versionNumber: number;
      effectiveDate: string;
    }>;

    const versionIds = candidates.map(row => row.versionId);
    let matchedVersionIds = new Set<number>();

    if (versionIds.length > 0) {
      await mongoClient.connect();

      const contents = mongoClient
        .db(env.mongoDb)
        .collection("document_contents");

      const matches = await contents.find(
        {
          versionId: { $in: versionIds },
          $or: [
            { "pages.text": { $regex: regex, $options: "i" } },
            { "extracted.keywords": { $regex: regex, $options: "i" } },
            { fileName: { $regex: regex, $options: "i" } },
            { category: { $regex: regex, $options: "i" } }
          ]
        },
        {
          projection: { _id: 1, versionId: 1, fileName: 1 }
        }
      ).toArray();

      matchedVersionIds = new Set(
        matches.map(item => Number(item.versionId))
      );
    }

    const results = candidates
      .filter(row => matchedVersionIds.has(row.versionId))
      .map(row => ({
        documentId: row.documentId,
        title: row.title,
        category: row.category,
        versionId: row.versionId,
        versionNumber: row.versionNumber,
        effectiveDate: row.effectiveDate
      }));

    await pgPool.query(
      `INSERT INTO search_logs
         (user_id, query_text, search_type, results_count)
       VALUES ($1, $2, 'keyword', $3)`,
      [userId, query, results.length]
    );

    response.json({
      query,
      type: "keyword",
      count: results.length,
      results
    });
  } catch (error) {
    next(error);
  }
});

export { router as searchRouter };
