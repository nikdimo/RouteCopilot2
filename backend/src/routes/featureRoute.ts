import { Router } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/types.js";
import {
  FeatureNotIncludedError,
  SettingsAccessLockedError,
  getUserFeatureAccess,
  updateUserFeaturePreferences
} from "../services/featureAccessService.js";

const featurePatchSchema = z
  .object({
    useAdvancedGeocoding: z.boolean().optional(),
    useTrafficRouting: z.boolean().optional()
  })
  .refine(
    (value) =>
      value.useAdvancedGeocoding !== undefined || value.useTrafficRouting !== undefined,
    {
      message: "At least one feature toggle must be provided"
    }
  );

export const featureRouter = Router();

featureRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const featureAccess = await getUserFeatureAccess(userId);
    return res.json(featureAccess);
  } catch (error) {
    console.error("Feature access read error:", error);
    return res.status(500).json({ error: "Failed to load feature access" });
  }
});

featureRouter.patch("/", async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = featurePatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      issues: parsed.error.flatten()
    });
  }

  try {
    const featureAccess = await updateUserFeaturePreferences(userId, parsed.data);
    return res.json(featureAccess);
  } catch (error) {
    if (error instanceof SettingsAccessLockedError) {
      return res.status(403).json({
        error: error.message,
        lockReason: error.lockReason,
        upgradeUrl: error.upgradeUrl
      });
    }
    if (error instanceof FeatureNotIncludedError) {
      return res.status(403).json({
        error: error.message,
        featureKey: error.featureKey,
        minimumTier: error.minimumTier,
        upgradeUrl: error.upgradeUrl
      });
    }
    console.error("Feature access update error:", error);
    return res.status(500).json({ error: "Failed to update feature access" });
  }
});
