import { Router } from "express";
import { z } from "zod";
import { requireAdmin, requireSuperAdmin } from "../middleware/admin.js";
import type { AuthenticatedRequest } from "../middleware/types.js";
import {
  getAdminMe,
  insertAdminAudit,
  listAdminAllowlist,
  listAdminAudit,
  listOrganizations,
  listTierOverrides,
  listUsers,
  listUserState,
  removeAdminAllowlist,
  removeTierOverride,
  upsertAdminAllowlist,
  upsertTierOverride
} from "../services/adminService.js";

const listQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

const dayKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/);

const userIdSchema = z.string().uuid();

const adminRoleSchema = z.enum(["support_admin", "super_admin"]);
const subscriptionTierSchema = z.enum(["free", "basic", "pro", "premium"]);

const upsertAdminBodySchema = z.object({
  userId: userIdSchema,
  role: adminRoleSchema
});

const upsertTierBodySchema = z.object({
  userId: userIdSchema,
  subscriptionTier: subscriptionTierSchema,
  reason: z.string().trim().max(500).optional()
});

const stateQuerySchema = z.object({
  dayKey: dayKeySchema.optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100)
});

export const adminRouter = Router();

adminRouter.use(requireAdmin);

adminRouter.get("/health", (_req, res) => {
  return res.json({ ok: true });
});

adminRouter.get("/me", async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const user = await getAdminMe(userId);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  return res.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      tenantId: user.tenant_id
    },
    admin: req.admin
  });
});

adminRouter.get("/users", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid query",
      issues: parsed.error.flatten()
    });
  }
  const users = await listUsers(parsed.data);
  return res.json({ users });
});

adminRouter.get("/organizations", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid query",
      issues: parsed.error.flatten()
    });
  }
  const organizations = await listOrganizations(parsed.data);
  return res.json({ organizations });
});

adminRouter.get("/admin-allowlist", async (_req, res) => {
  const admins = await listAdminAllowlist();
  return res.json({ admins });
});

adminRouter.post("/admin-allowlist", requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  const parsed = upsertAdminBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      issues: parsed.error.flatten()
    });
  }

  const entry = await upsertAdminAllowlist(parsed.data);
  await insertAdminAudit({
    adminUserId: req.auth!.userId,
    action: "admin.allowlist.upsert",
    targetType: "user",
    targetId: parsed.data.userId,
    details: { role: parsed.data.role }
  });

  return res.json({ entry });
});

adminRouter.delete("/admin-allowlist/:userId", requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  const parsed = userIdSchema.safeParse(req.params.userId);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid userId" });
  }

  const removed = await removeAdminAllowlist(parsed.data);
  if (removed) {
    await insertAdminAudit({
      adminUserId: req.auth!.userId,
      action: "admin.allowlist.remove",
      targetType: "user",
      targetId: parsed.data
    });
  }

  return res.json({ ok: removed });
});

adminRouter.get("/tier-overrides", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid query",
      issues: parsed.error.flatten()
    });
  }
  const overrides = await listTierOverrides(parsed.data);
  return res.json({ overrides });
});

adminRouter.post("/tier-overrides", async (req: AuthenticatedRequest, res) => {
  const parsed = upsertTierBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      issues: parsed.error.flatten()
    });
  }

  const override = await upsertTierOverride({
    userId: parsed.data.userId,
    subscriptionTier: parsed.data.subscriptionTier,
    reason: parsed.data.reason,
    adminUserId: req.auth!.userId
  });

  await insertAdminAudit({
    adminUserId: req.auth!.userId,
    action: "tier.override.upsert",
    targetType: "user",
    targetId: parsed.data.userId,
    details: {
      subscriptionTier: parsed.data.subscriptionTier,
      reason: parsed.data.reason ?? null
    }
  });

  return res.json({ override });
});

adminRouter.delete("/tier-overrides/:userId", async (req: AuthenticatedRequest, res) => {
  const parsed = userIdSchema.safeParse(req.params.userId);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid userId" });
  }

  const removed = await removeTierOverride(parsed.data);
  if (removed) {
    await insertAdminAudit({
      adminUserId: req.auth!.userId,
      action: "tier.override.remove",
      targetType: "user",
      targetId: parsed.data
    });
  }

  return res.json({ ok: removed });
});

adminRouter.get("/user-state", async (req, res) => {
  const parsed = stateQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid query",
      issues: parsed.error.flatten()
    });
  }
  const states = await listUserState(parsed.data);
  return res.json({ states });
});

adminRouter.get("/audit", async (req, res) => {
  const parsed = auditQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid query",
      issues: parsed.error.flatten()
    });
  }
  const entries = await listAdminAudit(parsed.data.limit);
  return res.json({ entries });
});
