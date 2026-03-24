import { Router } from "express";
import { z } from "zod";
import { requireAdmin, requireSuperAdmin } from "../middleware/admin.js";
import type { AuthenticatedRequest } from "../middleware/types.js";
import { getUserProfileSettings, updateUserProfileSettings } from "../services/profileSettingsService.js";
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
const hhmmRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

const userIdSchema = z.string().uuid();
const workingDaysSchema = z.tuple([
  z.boolean(),
  z.boolean(),
  z.boolean(),
  z.boolean(),
  z.boolean(),
  z.boolean(),
  z.boolean()
]);

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
const adminDecisionSettingsPatchSchema = z
  .object({
    workingHours: z
      .object({
        start: z.string().regex(hhmmRegex).optional(),
        end: z.string().regex(hhmmRegex).optional()
      })
      .optional(),
    workingDays: workingDaysSchema.optional(),
    preMeetingBuffer: z.number().int().min(0).max(240).optional(),
    postMeetingBuffer: z.number().int().min(0).max(240).optional(),
    distanceThresholdKm: z.number().finite().min(0).max(1000).optional(),
    farDetourOverrideMinSavingsMinutes: z
      .number()
      .int()
      .min(0)
      .max(240)
      .optional(),
    decisionOptimizationMetric: z.enum(["minutes", "km"]).optional(),
    meetingDurationPresets: z
      .tuple([
        z.number().int().min(15).max(480).multipleOf(15),
        z.number().int().min(15).max(480).multipleOf(15),
        z.number().int().min(15).max(480).multipleOf(15)
      ])
      .optional(),
    alwaysStartFromHomeBase: z.boolean().optional()
  })
  .refine(
    (value) => {
      if (!value.meetingDurationPresets) return true;
      const [a, b, c] = value.meetingDurationPresets;
      return a < b && b < c;
    },
    {
      message: "meetingDurationPresets must be strictly increasing",
      path: ["meetingDurationPresets"]
    }
  )
  .refine(
    (value) =>
      value.workingHours !== undefined ||
      value.workingDays !== undefined ||
      value.preMeetingBuffer !== undefined ||
      value.postMeetingBuffer !== undefined ||
      value.distanceThresholdKm !== undefined ||
      value.farDetourOverrideMinSavingsMinutes !== undefined ||
      value.decisionOptimizationMetric !== undefined ||
      value.meetingDurationPresets !== undefined ||
      value.alwaysStartFromHomeBase !== undefined,
    {
      message: "At least one setting must be provided"
    }
  );

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

adminRouter.get("/users/:userId/profile-settings", async (req, res) => {
  const parsed = userIdSchema.safeParse(req.params.userId);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid userId" });
  }

  try {
    const data = await getUserProfileSettings(parsed.data);
    return res.json(data);
  } catch (error) {
    console.error("Admin profile settings read error:", error);
    return res.status(500).json({ error: "Failed to load profile settings" });
  }
});

adminRouter.patch("/users/:userId/profile-settings", async (req: AuthenticatedRequest, res) => {
  const userIdParsed = userIdSchema.safeParse(req.params.userId);
  if (!userIdParsed.success) {
    return res.status(400).json({ error: "Invalid userId" });
  }

  const bodyParsed = adminDecisionSettingsPatchSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      issues: bodyParsed.error.flatten()
    });
  }

  try {
    const data = await updateUserProfileSettings(
      userIdParsed.data,
      bodyParsed.data,
      "admin",
      { bypassAccessChecks: true }
    );
    await insertAdminAudit({
      adminUserId: req.auth!.userId,
      action: "profile.settings.admin.update",
      targetType: "user",
      targetId: userIdParsed.data,
      details: bodyParsed.data
    });
    return res.json(data);
  } catch (error) {
    console.error("Admin profile settings update error:", error);
    return res.status(500).json({ error: "Failed to update profile settings" });
  }
});
