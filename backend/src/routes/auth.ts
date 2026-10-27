import { Router } from "express";
import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { pgPool } from "../config/databases.js";
import { cookieName, requireAuth, sessionCookieOptions, signSession } from "../middleware/auth.js";

const router = Router();
const loginLimit = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again in a minute." }
});
const loginSchema = z.object({
  email: z.string().email().max(255).transform(value => value.trim().toLowerCase()),
  password: z.string().min(1).max(200)
}).strict();

// A dummy hash keeps unknown-email and wrong-password attempts on the same bcrypt path.
const dummyPasswordHash = bcrypt.hashSync(randomBytes(32).toString("hex"), 12);

router.post("/login", loginLimit, async (request, response, next) => {
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const result = await pgPool.query(
      `SELECT user_id, full_name, email, password_hash, role_id, department_id, account_status
       FROM users WHERE lower(email) = $1`,
      [parsed.data.email]
    );
    const user = result.rows[0];
    const passwordMatches = await bcrypt.compare(parsed.data.password, user?.password_hash ?? dummyPasswordHash);
    if (!user || user.account_status !== "active" || !passwordMatches) {
      response.status(401).json({ error: "Invalid email or password" });
      return;
    }

    await pgPool.query("UPDATE users SET last_login_at = now() WHERE user_id = $1", [user.user_id]);
    const token = signSession(user.user_id);
    response.cookie(cookieName, token, sessionCookieOptions());
    response.json({
      user: {
        id: user.user_id,
        fullName: user.full_name,
        email: user.email,
        roleId: user.role_id,
        departmentId: user.department_id
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post("/logout", (_request, response) => {
  response.clearCookie(cookieName, sessionCookieOptions());
  response.status(204).end();
});

router.get("/me", requireAuth, (request, response) => {
  const user = request.user!;
  response.json({
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      roleId: user.roleId,
      role: user.role,
      departmentId: user.departmentId,
      permissions: user.permissions
    }
  });
});

export { router as authRouter };
