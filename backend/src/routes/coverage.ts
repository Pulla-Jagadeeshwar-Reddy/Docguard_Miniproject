import { Router } from "express";
import { z } from "zod";
import { pgPool } from "../config/databases.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const regulationsRouter = Router();
const controlsRouter = Router();
const mappingsRouter = Router();
const complianceRouter = Router();
const id = z.number().int().positive();
const regulationSchema = z.object({
  regulationName: z.string().trim().min(2).max(100),
  issuingBody: z.string().trim().min(2).max(150),
  description: z.string().trim().max(4000).optional()
}).strict();
const controlSchema = z.object({
  regulationId: id,
  controlCode: z.string().trim().min(1).max(50),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  isMandatory: z.boolean().default(true)
}).strict();
const mappingSchema = z.object({ documentId: id, controlId: id }).strict();
const admin = [requireAuth, requireRole("Admin")];

regulationsRouter.use(...admin);
regulationsRouter.get("/", async (_request, response, next) => {
  try {
    const result = await pgPool.query(
      `SELECT regulation_id AS "regulationId", regulation_name AS "regulationName",
              issuing_body AS "issuingBody", description,
              total_controls AS "totalControls", mandatory_controls AS "mandatoryControls",
              covered_mandatory_controls AS "coveredMandatoryControls",
              mandatory_gaps AS "mandatoryGaps", coverage_percent AS "coveragePercent"
       FROM v_regulatory_coverage_summary ORDER BY regulation_name`
    );
    response.json({ regulations: result.rows });
  } catch (error) { next(error); }
});
regulationsRouter.post("/", async (request, response, next) => {
  const parsed = regulationSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: "Invalid regulation" }); return; }
  try {
    const result = await pgPool.query(
      `INSERT INTO regulations(regulation_name, issuing_body, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (regulation_name) DO UPDATE SET issuing_body = EXCLUDED.issuing_body,
         description = EXCLUDED.description
       RETURNING regulation_id AS "regulationId", regulation_name AS "regulationName",
                 issuing_body AS "issuingBody", description`,
      [parsed.data.regulationName, parsed.data.issuingBody, parsed.data.description ?? null]
    );
    response.status(201).json({ regulation: result.rows[0] });
  } catch (error) { next(error); }
});

controlsRouter.use(...admin);
controlsRouter.get("/", async (request, response, next) => {
  const filter = request.query.regulationId === undefined ? null : z.coerce.number().int().positive().safeParse(request.query.regulationId);
  if (filter && !filter.success) { response.status(400).json({ error: "Invalid regulation id" }); return; }
  try {
    const result = await pgPool.query(
      `SELECT control_id AS "controlId", regulation_id AS "regulationId", regulation_name AS "regulationName",
              control_code AS "controlCode", control_title AS title, control_description AS description,
              is_mandatory AS "isMandatory", mapped_document_count AS "mappedDocumentCount",
              valid_document_count AS "validDocumentCount", is_covered AS "isCovered"
       FROM v_control_coverage
       WHERE $1::int IS NULL OR regulation_id = $1
       ORDER BY regulation_name, control_code`,
      [filter?.success ? filter.data : null]
    );
    response.json({ controls: result.rows });
  } catch (error) { next(error); }
});
controlsRouter.post("/", async (request, response, next) => {
  const parsed = controlSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: "Invalid control" }); return; }
  try {
    const result = await pgPool.query(
      `INSERT INTO controls(regulation_id, control_code, title, description, is_mandatory)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING control_id AS "controlId", regulation_id AS "regulationId",
                 control_code AS "controlCode", title, description, is_mandatory AS "isMandatory"`,
      [parsed.data.regulationId, parsed.data.controlCode, parsed.data.title,
       parsed.data.description ?? null, parsed.data.isMandatory]
    );
    response.status(201).json({ control: result.rows[0] });
  } catch (error) { next(error); }
});

mappingsRouter.use(...admin);
mappingsRouter.get("/", async (_request, response, next) => {
  try {
    const result = await pgPool.query(
      `SELECT dcm.document_id AS "documentId", d.title AS "documentTitle",
              c.control_id AS "controlId", r.regulation_name AS "regulationName",
              c.control_code AS "controlCode", c.title AS "controlTitle", dcm.mapped_at AS "mappedAt"
       FROM document_control_map dcm
       JOIN documents d ON d.document_id = dcm.document_id
       JOIN controls c ON c.control_id = dcm.control_id
       JOIN regulations r ON r.regulation_id = c.regulation_id
       ORDER BY r.regulation_name, c.control_code, d.title`
    );
    response.json({ mappings: result.rows });
  } catch (error) { next(error); }
});
mappingsRouter.post("/", async (request, response, next) => {
  const parsed = mappingSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: "Invalid control mapping" }); return; }
  try {
    const result = await pgPool.query(
      `INSERT INTO document_control_map(document_id, control_id, mapped_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (document_id, control_id) DO NOTHING
       RETURNING document_id AS "documentId", control_id AS "controlId", mapped_at AS "mappedAt"`,
      [parsed.data.documentId, parsed.data.controlId, request.user!.id]
    );
    response.status(result.rowCount ? 201 : 200).json({ mapping: result.rows[0] ?? { ...parsed.data }, alreadyMapped: !result.rowCount });
  } catch (error) { next(error); }
});

complianceRouter.use(...admin);
complianceRouter.get("/coverage", async (_request, response, next) => {
  try {
    const [regulations, controls] = await Promise.all([
      pgPool.query(
        `SELECT regulation_id AS "regulationId", regulation_name AS "regulationName",
                issuing_body AS "issuingBody", total_controls AS "totalControls",
                mandatory_controls AS "mandatoryControls", covered_mandatory_controls AS "coveredMandatoryControls",
                mandatory_gaps AS "mandatoryGaps", coverage_percent AS "coveragePercent"
         FROM v_regulatory_coverage_summary ORDER BY regulation_name`
      ),
      pgPool.query(
        `SELECT regulation_id AS "regulationId", regulation_name AS "regulationName",
                control_id AS "controlId", control_code AS "controlCode", control_title AS title,
                control_description AS description, is_mandatory AS "isMandatory",
                mapped_document_count AS "mappedDocumentCount", valid_document_count AS "validDocumentCount",
                is_covered AS "isCovered"
         FROM v_control_coverage ORDER BY regulation_name, control_code`
      )
    ]);
    response.json({ regulations: regulations.rows, controls: controls.rows });
  } catch (error) { next(error); }
});

export { regulationsRouter, controlsRouter, mappingsRouter, complianceRouter as coverageComplianceRouter };
