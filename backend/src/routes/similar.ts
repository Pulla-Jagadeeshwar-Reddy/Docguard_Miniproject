import { Router } from "express";
import { z } from "zod";
import { pgPool } from "../config/databases.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
const idSchema = z.coerce.number().int().positive();
router.use(requireAuth);

router.get("/:id/similar", async (request, response, next) => {
  const parsed = idSchema.safeParse(request.params.id);
  if (!parsed.success) { response.status(400).json({ error: "Invalid document id" }); return; }
  try {
    const result = await pgPool.query(
      `WITH source AS (
         SELECT d.document_id
         FROM documents d
         JOIN document_versions v ON v.version_id = d.current_version_id
         WHERE d.document_id = $1 AND d.document_status = 'active'
           AND v.version_status = 'approved'
           AND (v.expiry_date IS NULL OR v.expiry_date >= CURRENT_DATE)
           AND d.document_id IN (SELECT document_id FROM fn_accessible_document_ids($2))
       ), related AS (
         SELECT CASE WHEN sd.document_id_1 = source.document_id THEN sd.document_id_2 ELSE sd.document_id_1 END AS document_id,
                sd.similarity_score
         FROM source JOIN similar_documents sd
           ON sd.document_id_1 = source.document_id OR sd.document_id_2 = source.document_id
       )
       SELECT d.document_id AS "documentId", d.title, c.category_name AS category,
              v.version_id AS "versionId", r.similarity_score AS score
       FROM related r
       JOIN documents d ON d.document_id = r.document_id AND d.document_status = 'active'
       JOIN document_categories c ON c.category_id = d.category_id
       JOIN document_versions v ON v.version_id = d.current_version_id AND v.document_id = d.document_id
       WHERE v.version_status = 'approved'
         AND (v.expiry_date IS NULL OR v.expiry_date >= CURRENT_DATE)
         AND d.document_id IN (SELECT document_id FROM fn_accessible_document_ids($2))
       ORDER BY r.similarity_score DESC, d.title
       LIMIT 10`,
      [parsed.data, request.user!.id]
    );
    const source = await pgPool.query(
      `SELECT 1 FROM documents d JOIN document_versions v ON v.version_id = d.current_version_id
       WHERE d.document_id = $1 AND d.document_status = 'active' AND v.version_status = 'approved'
         AND (v.expiry_date IS NULL OR v.expiry_date >= CURRENT_DATE)
         AND d.document_id IN (SELECT document_id FROM fn_accessible_document_ids($2))`,
      [parsed.data, request.user!.id]
    );
    if (!source.rowCount) { response.status(404).json({ error: "Document not found" }); return; }
    response.json({ documentId: parsed.data, similar: result.rows });
  } catch (error) { next(error); }
});

export { router as similarRouter };
