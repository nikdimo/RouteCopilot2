import type { NextFunction, Response } from "express";
import { query } from "../db/pool.js";
import { env } from "../config/env.js";
import type { AdminRole, AuthenticatedRequest } from "./types.js";

type AdminRow = {
  role: AdminRole;
};

async function findAdminRole(userId: string) {
  const found = await query<AdminRow>(
    `SELECT role
     FROM admin_allowlist
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );
  return found.rows[0]?.role ?? null;
}

export async function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    let role = await findAdminRole(userId);
    if (!role && env.AUTH_MODE === "dev") {
      await query(
        `INSERT INTO admin_allowlist(user_id, role)
         VALUES ($1, 'super_admin')
         ON CONFLICT (user_id) DO NOTHING`,
        [userId]
      );
      role = await findAdminRole(userId);
    }

    if (!role) {
      return res.status(403).json({ error: "Admin access required" });
    }

    req.admin = { role };
    return next();
  } catch (error) {
    console.error("Admin auth error:", error);
    return res.status(500).json({ error: "Admin auth failed" });
  }
}

export function requireSuperAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  if (req.admin?.role !== "super_admin") {
    return res.status(403).json({ error: "Super admin role required" });
  }
  return next();
}
