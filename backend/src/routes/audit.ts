import { Router } from "express";
import { z } from "zod";
import { pgPool } from "../config/databases.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

const router = Router();
const filterSchema = z.object({
  userId: z.coerce.number().int().positive().optional(),
  documentId: z.coerce.number().int().positive().optional(),
  action: z.enum(["view", "download", "upload", "edit", "approve"]).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
}).strict();

router.use(requireAuth, requirePermission("AUDIT_READ"));

router.get("/logs", async (request, response, next) => {
  const parsed = filterSchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid audit filters" });
    return;
  }
  const filters = parsed.data;
  const clauses: string[] = [];
  const values: unknown[] = [];
  const addFilter = (sql: string, value: unknown) => {
    values.push(value);
    clauses.push(sql.replace("?", `$${values.length}`));
  };
  if (filters.userId !== undefined) addFilter("l.user_id = ?", filters.userId);
  if (filters.documentId !== undefined) addFilter("l.document_id = ?", filters.documentId);
  if (filters.action !== undefined) addFilter("l.action = ?", filters.action);
  if (filters.from !== undefined) addFilter("l.accessed_at >= ?::timestamptz", filters.from);
  if (filters.to !== undefined) addFilter("l.accessed_at <= ?::timestamptz", filters.to);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const [logs, total, checks] = await Promise.all([
      pgPool.query(
        `SELECT l.log_id AS id, l.user_id AS "userId", u.full_name AS user,
                l.document_id AS "documentId", d.title AS document,
                l.version_id AS "versionId", v.version_number AS version,
                l.override_id AS "overrideId", l.action, l.is_break_glass AS "breakGlass",
                l.ip_address AS ip, l.accessed_at AS "accessedAt", l.prev_hash AS "previousHash", l.row_hash AS "rowHash"
         FROM access_logs l
         JOIN users u ON u.user_id = l.user_id
         JOIN documents d ON d.document_id = l.document_id
         LEFT JOIN document_versions v ON v.version_id = l.version_id
         ${where}
         ORDER BY l.log_id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, filters.limit, filters.offset]
      ),
      pgPool.query(`SELECT count(*)::int AS count FROM access_logs l ${where}`, values),
      pgPool.query(
        `SELECT c.check_id AS id, c.run_at AS "runAt", c.rows_verified AS "rowsVerified",
                c.result, c.first_broken_log_id AS "firstBrokenLogId", u.full_name AS "runBy"
         FROM audit_integrity_checks c JOIN users u ON u.user_id = c.run_by
         ORDER BY c.run_at DESC, c.check_id DESC LIMIT 10`
      )
    ]);
    response.json({ logs: logs.rows, total: total.rows[0].count, integrityChecks: checks.rows });
  } catch (error) { next(error); }
});

router.post("/verify", requirePermission("AUDIT_VERIFY"), async (request, response, next) => {
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    // Match the hash trigger's lock; the runtime role can verify safely without write privileges.
    await client.query("SELECT pg_advisory_xact_lock(727001)");
    const integrity = await client.query("SELECT verify_audit_chain() AS first_broken_log_id");
    const count = await client.query("SELECT count(*)::bigint AS rows_verified FROM access_logs");
    const firstBrokenLogId = integrity.rows[0].first_broken_log_id as number | null;
    const result = firstBrokenLogId === null ? "intact" : "tampered";
    const saved = await client.query(
      `INSERT INTO audit_integrity_checks(run_by, rows_verified, result, first_broken_log_id)
       VALUES ($1, $2, $3, $4)
       RETURNING check_id AS id, run_at AS "runAt", rows_verified AS "rowsVerified", result, first_broken_log_id AS "firstBrokenLogId"`,
      [request.user!.id, count.rows[0].rows_verified, result, firstBrokenLogId]
    );
    await client.query("COMMIT");
    response.json({ check: saved.rows[0] });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Transaction may already be closed. */ }
    next(error);
  } finally { client.release(); }
});

export { router as auditRouter };
