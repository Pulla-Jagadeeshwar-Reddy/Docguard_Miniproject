import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { pgPool } from "../config/databases.js";

const cookieName = "docuguard_session";

function sessionSeconds(): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(env.jwtExpiresIn);
  if (!match) throw new Error("JWT_EXPIRES_IN must use seconds, minutes, hours, or days (for example 1h)");
  const amount = Number(match[1]);
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[match[2] as "s" | "m" | "h" | "d"];
  if (amount < 1 || amount > 86400) throw new Error("JWT_EXPIRES_IN must be between one second and one day");
  return amount * multiplier;
}

export function signSession(userId: number): string {
  return jwt.sign({ sub: String(userId) }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"]
  });
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax" as const,
    path: "/",
    maxAge: sessionSeconds() * 1000
  };
}

export async function requireAuth(request: Request, response: Response, next: NextFunction) {
  const token = request.cookies?.[cookieName];
  if (!token) {
    response.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret);
    if (typeof payload === "string" || !payload.sub || !/^\d+$/.test(payload.sub)) {
      response.status(401).json({ error: "Authentication required" });
      return;
    }

    // Reload role and permissions so a suspended account or changed role takes effect immediately.
    const result = await pgPool.query(
      `SELECT u.user_id, u.full_name, u.email, u.role_id, r.role_name,
              u.department_id, u.account_status,
              COALESCE(array_agg(p.permission_name) FILTER (WHERE p.permission_name IS NOT NULL), '{}') AS permissions
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.role_id
       LEFT JOIN permissions p ON p.permission_id = rp.permission_id
       WHERE u.user_id = $1
       GROUP BY u.user_id, u.full_name, u.email, u.role_id, r.role_name, u.department_id, u.account_status`,
      [Number(payload.sub)]
    );
    const user = result.rows[0];
    if (!user || user.account_status !== "active") {
      response.status(401).json({ error: "Authentication required" });
      return;
    }
    request.user = {
      id: user.user_id,
      fullName: user.full_name,
      email: user.email,
      roleId: user.role_id,
      role: user.role_name,
      departmentId: user.department_id,
      permissions: user.permissions
    };
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      response.status(401).json({ error: "Authentication required" });
      return;
    }
    next(error);
  }
}

export function requireRole(...roles: string[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!request.user) {
      response.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!roles.includes(request.user.role)) {
      response.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}

export function requirePermission(permission: string) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!request.user) {
      response.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!request.user.permissions.includes(permission)) {
      response.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}

export { cookieName };
