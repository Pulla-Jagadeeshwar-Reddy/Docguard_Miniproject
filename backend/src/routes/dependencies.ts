import { Router } from "express";
import { z } from "zod";
import { pgPool } from "../config/databases.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
const idSchema = z.coerce.number().int().positive();
const referenceSchema = z.object({
  targetDocumentId: z.number().int().positive(),
  referenceType: z.enum(["cites", "depends_on", "supersedes"]).default("depends_on")
}).strict();

router.use(requireAuth, requireRole("Admin"));

router.post("/:id/references", async (request, response, next) => {
  const sourceId = idSchema.safeParse(request.params.id);
  const body = referenceSchema.safeParse(request.body);
  if (!sourceId.success || !body.success) {
    response.status(400).json({ error: "Invalid reference" });
    return;
  }
  try {
    const result = await pgPool.query(
      `INSERT INTO document_references(source_document_id, target_document_id, reference_type)
       VALUES ($1, $2, $3)
       RETURNING reference_id AS id, source_document_id AS "sourceDocumentId",
                 target_document_id AS "targetDocumentId", reference_type AS type`,
      [sourceId.data, body.data.targetDocumentId, body.data.referenceType]
    );
    response.status(201).json({ reference: result.rows[0] });
  } catch (error) { next(error); }
});

router.get("/:id/impact", async (request, response, next) => {
  const parsedId = idSchema.safeParse(request.params.id);
  if (!parsedId.success) { response.status(400).json({ error: "Invalid document id" }); return; }
  try {
    const exists = await pgPool.query("SELECT document_id FROM documents WHERE document_id = $1", [parsedId.data]);
    if (!exists.rowCount) { response.status(404).json({ error: "Document not found" }); return; }
    const result = await pgPool.query(
      `WITH RECURSIVE impacted(document_id, depth, path) AS (
         SELECT r.source_document_id, 1, ARRAY[$1::integer, r.source_document_id]
         FROM document_references AS r
         WHERE r.target_document_id = $1
         UNION ALL
         SELECT r.source_document_id, i.depth + 1, i.path || r.source_document_id
         FROM document_references AS r
         JOIN impacted AS i ON r.target_document_id = i.document_id
         WHERE NOT r.source_document_id = ANY(i.path)
       )
       SELECT d.document_id AS id, d.title, min(i.depth)::integer AS depth
       FROM impacted AS i
       JOIN documents AS d ON d.document_id = i.document_id
       GROUP BY d.document_id, d.title
       ORDER BY depth, d.title`,
      [parsedId.data]
    );
    response.json({ impactedDocuments: result.rows });
  } catch (error) { next(error); }
});

router.get("/:id/graph", async (request, response, next) => {
  const parsedId = idSchema.safeParse(request.params.id);
  if (!parsedId.success) { response.status(400).json({ error: "Invalid document id" }); return; }
  try {
    const root = await pgPool.query("SELECT document_id AS id, title FROM documents WHERE document_id = $1", [parsedId.data]);
    if (!root.rowCount) { response.status(404).json({ error: "Document not found" }); return; }

    // The path array makes graph traversal terminate when references contain cycles.
    const nodesResult = await pgPool.query(
      `WITH RECURSIVE reachable(document_id, path, depth) AS (
         SELECT $1::integer, ARRAY[$1::integer], 0
         UNION ALL
         SELECT neighbor.document_id, reachable.path || neighbor.document_id, reachable.depth + 1
         FROM reachable
         JOIN LATERAL (
           SELECT target_document_id AS document_id FROM document_references WHERE source_document_id = reachable.document_id
           UNION ALL
           SELECT source_document_id AS document_id FROM document_references WHERE target_document_id = reachable.document_id
         ) AS neighbor ON true
         WHERE NOT neighbor.document_id = ANY(reachable.path)
       )
       SELECT d.document_id AS id, d.title, min(r.depth)::integer AS depth
       FROM reachable AS r JOIN documents AS d ON d.document_id = r.document_id
       GROUP BY d.document_id, d.title
       ORDER BY depth, d.title`,
      [parsedId.data]
    );
    const ids = nodesResult.rows.map((node: { id: number }) => node.id);
    const edgesResult = await pgPool.query(
      `SELECT source_document_id AS source, target_document_id AS target,
              reference_type AS type
       FROM document_references
       WHERE source_document_id = ANY($1::integer[]) AND target_document_id = ANY($1::integer[])
       ORDER BY source_document_id, target_document_id, reference_type`,
      [ids]
    );
    response.json({ root: root.rows[0], nodes: nodesResult.rows, edges: edgesResult.rows });
  } catch (error) { next(error); }
});

export { router as dependenciesRouter };
