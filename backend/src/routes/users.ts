import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { pgPool } from "../config/databases.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

const router = Router();
const createSchema = z.object({
  fullName: z.string().trim().min(1).max(150),
  email: z.string().email().max(255).transform(value => value.trim().toLowerCase()),
  password: z.string().min(12).max(200),
  roleId: z.number().int().positive(),
  departmentId: z.number().int().positive().nullable().optional()
}).strict();
const updateSchema = z.object({
  fullName: z.string().trim().min(1).max(150).optional(),
  password: z.string().min(12).max(200).optional(),
  roleId: z.number().int().positive().optional(),
  departmentId: z.number().int().positive().nullable().optional(),
  employmentStatus: z.string().trim().min(1).max(20).optional(),
  accountStatus: z.enum(["active", "suspended", "disabled"]).optional()
}).strict().refine(value => Object.keys(value).length > 0, "At least one field is required");
const idSchema = z.coerce.number().int().positive();

router.use(requireAuth, requirePermission("USER_ADMIN"));

router.get("/", async (request, response, next) => {
  try {
    const q = typeof request.query.q === "string" ? request.query.q.trim().slice(0, 100) : "";
    const [users, roles, departments] = await Promise.all([
      pgPool.query(
        `SELECT u.user_id AS id, u.full_name AS "fullName", u.email,
                u.role_id AS "roleId", r.role_name AS role,
                u.department_id AS "departmentId", d.department_name AS department,
                u.employment_status AS "employmentStatus", u.account_status AS "accountStatus",
                u.created_at AS "createdAt", u.last_login_at AS "lastLoginAt"
         FROM users u JOIN roles r ON r.role_id = u.role_id
         LEFT JOIN departments d ON d.department_id = u.department_id
         WHERE $1 = '' OR u.full_name ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%'
         ORDER BY u.full_name`, [q]
      ),
      pgPool.query("SELECT role_id AS id, role_name AS name FROM roles ORDER BY role_id"),
      pgPool.query("SELECT department_id AS id, department_name AS name FROM departments ORDER BY department_name")
    ]);
    response.json({ users: users.rows, roles: roles.rows, departments: departments.rows });
  } catch (error) { next(error); }
});

router.post("/", async (request, response, next) => {
  const parsed = createSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid request", issues: parsed.error.issues.map(issue => issue.path.join(".")) });
    return;
  }
  try {
    const { fullName, email, password, roleId, departmentId } = parsed.data;
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pgPool.query(
      `INSERT INTO users(full_name, email, password_hash, role_id, department_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING user_id AS id, full_name AS "fullName", email, role_id AS "roleId", department_id AS "departmentId", account_status AS "accountStatus"`,
      [fullName, email, passwordHash, roleId, departmentId ?? null]
    );
    response.status(201).json({ user: result.rows[0] });
  } catch (error) { next(error); }
});

router.patch("/:id", async (request, response, next) => {
  const id = idSchema.safeParse(request.params.id);
  const parsed = updateSchema.safeParse(request.body);
  if (!id.success || !parsed.success) {
    response.status(400).json({ error: "Invalid request" });
    return;
  }
  if (id.data === request.user!.id && parsed.data.accountStatus && parsed.data.accountStatus !== "active") {
    response.status(400).json({ error: "You cannot suspend or disable your own account" });
    return;
  }
  try {
    const fields: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown) => {
      values.push(value);
      fields.push(`${column} = $${values.length}`);
    };
    const patch = parsed.data;
    if (patch.fullName !== undefined) add("full_name", patch.fullName);
    if (patch.password !== undefined) add("password_hash", await bcrypt.hash(patch.password, 12));
    if (patch.roleId !== undefined) add("role_id", patch.roleId);
    if (patch.departmentId !== undefined) add("department_id", patch.departmentId);
    if (patch.employmentStatus !== undefined) add("employment_status", patch.employmentStatus);
    if (patch.accountStatus !== undefined) add("account_status", patch.accountStatus);
    values.push(id.data);
    const result = await pgPool.query(
      `UPDATE users SET ${fields.join(", ")} WHERE user_id = $${values.length}
       RETURNING user_id AS id, full_name AS "fullName", email, role_id AS "roleId", department_id AS "departmentId", employment_status AS "employmentStatus", account_status AS "accountStatus"`,
      values
    );
    if (!result.rowCount) {
      response.status(404).json({ error: "User not found" });
      return;
    }
    response.json({ user: result.rows[0] });
  } catch (error) { next(error); }
});

export { router as usersRouter };
