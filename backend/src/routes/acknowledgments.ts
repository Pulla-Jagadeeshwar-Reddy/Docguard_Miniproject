import { Router } from "express";
import { z } from "zod";
import { pgPool } from "../config/databases.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const acknowledgmentsRouter = Router();
const assignmentsRouter = Router();
const idSchema = z.coerce.number().int().positive();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");
const assignmentSchema = z.object({
  documentId: z.number().int().positive(),
  targetType: z.enum(["role", "department"]),
  targetRoleId: z.number().int().positive().optional(),
  targetDepartmentId: z.number().int().positive().optional(),
  dueDate: dateSchema.refine(value => value >= new Date().toISOString().slice(0, 10), "Due date must be today or later")
}).strict().refine(value => value.targetType === "role"
  ? value.targetRoleId !== undefined && value.targetDepartmentId === undefined
  : value.targetDepartmentId !== undefined && value.targetRoleId === undefined,
"Choose exactly one role or department target");

acknowledgmentsRouter.use(requireAuth);
acknowledgmentsRouter.get("/mine", async (request, response, next) => {
  try {
    const result = await pgPool.query(
      `SELECT pa.assignment_id AS "assignmentId", d.document_id AS "documentId",
              d.title, dc.category_name AS category, v.version_id AS "versionId",
              v.version_number AS "versionNumber", pa.due_date AS "dueDate",
              (a.ack_id IS NOT NULL) AS acknowledged,
              a.acknowledged_at AS "acknowledgedAt",
              (pa.due_date < CURRENT_DATE AND a.ack_id IS NULL) AS overdue
       FROM policy_assignments pa
       JOIN documents d ON d.document_id = pa.document_id AND d.current_version_id IS NOT NULL
       JOIN document_categories dc ON dc.category_id = d.category_id
       JOIN document_versions v ON v.version_id = d.current_version_id AND v.document_id = d.document_id
       JOIN users u ON u.user_id = $1 AND u.account_status = 'active'
         AND (pa.target_role_id IS NULL OR pa.target_role_id = u.role_id)
         AND (pa.target_department_id IS NULL OR pa.target_department_id = u.department_id)
       LEFT JOIN acknowledgments a ON a.assignment_id = pa.assignment_id
         AND a.user_id = u.user_id AND a.version_id = v.version_id
       WHERE d.document_status = 'active' AND v.version_status = 'approved'
         AND (v.expiry_date IS NULL OR v.expiry_date >= CURRENT_DATE)
       ORDER BY (a.ack_id IS NOT NULL), pa.due_date, d.title`,
      [request.user!.id]
    );
    response.json({ policies: result.rows });
  } catch (error) { next(error); }
});

acknowledgmentsRouter.post("/", async (request, response, next) => {
  const parsed = z.object({ assignmentId: idSchema }).strict().safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: "Invalid assignment" }); return; }
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO acknowledgments(assignment_id, user_id, version_id)
       SELECT pa.assignment_id, u.user_id, v.version_id
       FROM policy_assignments pa
       JOIN documents d ON d.document_id = pa.document_id AND d.current_version_id IS NOT NULL
       JOIN document_versions v ON v.version_id = d.current_version_id AND v.document_id = d.document_id
       JOIN users u ON u.user_id = $2 AND u.account_status = 'active'
         AND (pa.target_role_id IS NULL OR pa.target_role_id = u.role_id)
         AND (pa.target_department_id IS NULL OR pa.target_department_id = u.department_id)
       WHERE pa.assignment_id = $1 AND d.document_status = 'active'
         AND v.version_status = 'approved'
         AND (v.expiry_date IS NULL OR v.expiry_date >= CURRENT_DATE)
       ON CONFLICT (assignment_id, user_id, version_id) DO NOTHING
       RETURNING ack_id AS id, assignment_id AS "assignmentId", version_id AS "versionId", acknowledged_at AS "acknowledgedAt"`,
      [parsed.data.assignmentId, request.user!.id]
    );
    if (!result.rowCount) {
      const existing = await client.query(
        `SELECT a.ack_id AS id, a.assignment_id AS "assignmentId", a.version_id AS "versionId",
                a.acknowledged_at AS "acknowledgedAt"
         FROM acknowledgments a
         JOIN policy_assignments pa ON pa.assignment_id = a.assignment_id
         JOIN documents d ON d.document_id = pa.document_id AND d.current_version_id = a.version_id
         WHERE a.assignment_id = $1 AND a.user_id = $2`,
        [parsed.data.assignmentId, request.user!.id]
      );
      await client.query("COMMIT");
      if (existing.rowCount) { response.json({ acknowledgment: existing.rows[0], alreadyAcknowledged: true }); return; }
      response.status(404).json({ error: "Current policy assignment not found" });
      return;
    }
    await client.query("COMMIT");
    response.status(201).json({ acknowledgment: result.rows[0], alreadyAcknowledged: false });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    next(error);
  } finally { client.release(); }
});

assignmentsRouter.use(requireAuth, requireRole("Admin"));
assignmentsRouter.get("/", async (_request, response, next) => {
  try {
    const result = await pgPool.query(
      `SELECT pa.assignment_id AS "assignmentId", d.document_id AS "documentId", d.title,
              pa.target_role_id AS "targetRoleId", r.role_name AS "targetRole",
              pa.target_department_id AS "targetDepartmentId", dep.department_name AS "targetDepartment",
              pa.due_date AS "dueDate", COALESCE(c.eligible_users, 0) AS "eligibleUsers",
              COALESCE(c.acknowledged_users, 0) AS "acknowledgedUsers",
              COALESCE(c.pending_users, 0) AS "pendingUsers",
              COALESCE(c.completion_percent, 0) AS "completionPercent"
       FROM policy_assignments pa
       JOIN documents d ON d.document_id = pa.document_id
       LEFT JOIN roles r ON r.role_id = pa.target_role_id
       LEFT JOIN departments dep ON dep.department_id = pa.target_department_id
       LEFT JOIN v_ack_compliance c ON c.assignment_id = pa.assignment_id
       ORDER BY pa.assigned_at DESC, pa.assignment_id DESC`
    );
    response.json({ assignments: result.rows });
  } catch (error) { next(error); }
});

assignmentsRouter.post("/", async (request, response, next) => {
  const parsed = assignmentSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: "Invalid policy assignment" }); return; }
  try {
    const eligible = await pgPool.query(
      `SELECT d.document_id FROM documents d
       JOIN document_versions v ON v.version_id = d.current_version_id
       WHERE d.document_id = $1 AND d.document_status = 'active'
         AND v.version_status = 'approved'
         AND (v.expiry_date IS NULL OR v.expiry_date >= CURRENT_DATE)`,
      [parsed.data.documentId]
    );
    if (!eligible.rowCount) { response.status(409).json({ error: "Choose a policy with a current approved version" }); return; }
    const result = await pgPool.query(
      `INSERT INTO policy_assignments(document_id, target_role_id, target_department_id, assigned_by, due_date)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING assignment_id AS "assignmentId", document_id AS "documentId", due_date AS "dueDate"`,
      [parsed.data.documentId, parsed.data.targetRoleId ?? null, parsed.data.targetDepartmentId ?? null,
       request.user!.id, parsed.data.dueDate]
    );
    response.status(201).json({ assignment: result.rows[0] });
  } catch (error) { next(error); }
});

const complianceRouter = Router();
complianceRouter.use(requireAuth, requireRole("Admin"));
complianceRouter.get("/acknowledgments", async (_request, response, next) => {
  try {
    const [assignments, departments] = await Promise.all([
      pgPool.query("SELECT * FROM v_ack_compliance ORDER BY due_date, document_title"),
      pgPool.query("SELECT * FROM v_ack_compliance_by_department ORDER BY completion_percent, department_name")
    ]);
    response.json({ assignments: assignments.rows, departments: departments.rows });
  } catch (error) { next(error); }
});

export { acknowledgmentsRouter, assignmentsRouter, complianceRouter };
