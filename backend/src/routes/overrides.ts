import { Router } from "express";
import { z } from "zod";
import { pgPool } from "../config/databases.js";
import { requireAuth, requirePermission, requireRole } from "../middleware/auth.js";

const router = Router();
const requestSchema = z.object({
  documentId: z.number().int().positive(),
  justification: z.string().trim().min(20).max(2000),
  durationHours: z.number().int().min(1).max(24)
}).strict();
const reviewSchema = z.object({ outcome: z.enum(["justified", "unjustified"]) }).strict();
const idSchema = z.coerce.number().int().positive();

router.post("/", requireAuth, requirePermission("BREAK_GLASS_REQUEST"), requireRole("Doctor", "Nurse"), async (request, response, next) => {
  const parsed = requestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Enter a document id, a justification of at least 20 characters, and a duration from 1 to 24 hours" });
    return;
  }

  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    // Serialize requests for one user and policy so parallel submissions cannot double-grant access.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`break-glass:${request.user!.id}:${parsed.data.documentId}`]);
    const existing = await client.query(
      `SELECT 1 FROM access_overrides
       WHERE user_id = $1 AND document_id = $2 AND status = 'active' AND expires_at > now()`,
      [request.user!.id, parsed.data.documentId]
    );
    if (existing.rowCount) {
      await client.query("ROLLBACK");
      response.status(409).json({ error: "An active emergency access grant already exists" });
      return;
    }
    const document = await client.query(
      `SELECT d.document_id, d.title, d.current_version_id
       FROM documents AS d
       JOIN document_versions AS v ON v.version_id = d.current_version_id
       WHERE d.document_id = $1 AND d.document_status = 'active'
         AND v.version_status = 'approved'
         AND (v.expiry_date IS NULL OR v.expiry_date >= CURRENT_DATE)
         AND NOT EXISTS (
           SELECT 1 FROM fn_accessible_document_ids($2) AS accessible
           WHERE accessible.document_id = d.document_id
         )
       FOR SHARE OF d`,
      [parsed.data.documentId, request.user!.id]
    );
    if (!document.rowCount) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Document not found or not eligible for emergency access" });
      return;
    }
    const override = await client.query(
      `INSERT INTO access_overrides(user_id, document_id, justification, expires_at)
       VALUES ($1, $2, $3, now() + $4 * interval '1 hour')
       RETURNING override_id AS id, granted_at AS "grantedAt", expires_at AS "expiresAt"`,
      [request.user!.id, parsed.data.documentId, parsed.data.justification, parsed.data.durationHours]
    );
    await client.query(
      `INSERT INTO access_logs(user_id, document_id, version_id, override_id, action, is_break_glass, ip_address)
       VALUES ($1, $2, $3, $4, 'view', true, $5)`,
      [request.user!.id, parsed.data.documentId, document.rows[0].current_version_id, override.rows[0].id, request.ip ?? null]
    );
    await client.query(
      `INSERT INTO notifications(user_id, document_id, notification_type, message)
       SELECT admin.user_id, $1, 'break_glass_review',
              format('Emergency access was requested by %s for policy "%s".', $2::text, $3::text)
       FROM users AS admin JOIN roles AS role ON role.role_id = admin.role_id
       WHERE role.role_name = 'Admin' AND admin.account_status = 'active'`,
      [parsed.data.documentId, request.user!.fullName, document.rows[0].title]
    );
    await client.query("COMMIT");
    response.status(201).json({ override: { ...override.rows[0], documentId: parsed.data.documentId } });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Preserve the original failure. */ }
    next(error);
  } finally { client.release(); }
});

router.get("/pending", requireAuth, requirePermission("BREAK_GLASS_REVIEW"), requireRole("Admin"), async (_request, response, next) => {
  try {
    const result = await pgPool.query(
      `SELECT q.override_id AS id, q.requester_id AS "requesterId",
              q.requester_name AS requester, q.document_id AS "documentId",
              q.document_title AS document, q.justification,
              q.granted_at AS "grantedAt", q.expires_at AS "expiresAt", q.status
       FROM v_break_glass_review_queue AS q
       ORDER BY q.granted_at DESC, q.override_id DESC`
    );
    response.json({ requests: result.rows });
  } catch (error) { next(error); }
});

router.post("/:id/review", requireAuth, requirePermission("BREAK_GLASS_REVIEW"), requireRole("Admin"), async (request, response, next) => {
  const parsedId = idSchema.safeParse(request.params.id);
  const body = reviewSchema.safeParse(request.body);
  if (!parsedId.success || !body.success) {
    response.status(400).json({ error: "Invalid review request" });
    return;
  }
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const pending = await client.query(
      `SELECT user_id FROM access_overrides
       WHERE override_id = $1 AND reviewed_by IS NULL FOR UPDATE`,
      [parsedId.data]
    );
    if (!pending.rowCount) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Pending emergency access request not found" });
      return;
    }
    if (pending.rows[0].user_id === request.user!.id) {
      await client.query("ROLLBACK");
      response.status(400).json({ error: "The requester cannot review their own request" });
      return;
    }
    const reviewed = await client.query(
      `UPDATE access_overrides
       SET status = 'reviewed', reviewed_by = $1, reviewed_at = now(), review_outcome = $2
       WHERE override_id = $3
       RETURNING override_id AS id, status, reviewed_at AS "reviewedAt", review_outcome AS outcome`,
      [request.user!.id, body.data.outcome, parsedId.data]
    );
    await client.query("COMMIT");
    response.json({ request: reviewed.rows[0] });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Preserve the original failure. */ }
    next(error);
  } finally { client.release(); }
});

export { router as overridesRouter };
