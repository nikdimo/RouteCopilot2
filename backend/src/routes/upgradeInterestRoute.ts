import { Router } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/types.js";
import { requestUpgradePlansEmail } from "../services/upgradeInterestService.js";

const requestSchema = z.object({
  requiredPlan: z.enum(["basic", "pro", "premium"]),
  featureName: z.string().trim().max(120).optional(),
  featureKey: z.string().trim().max(120).optional()
});

export const upgradeInterestRouter = Router();

upgradeInterestRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      issues: parsed.error.flatten()
    });
  }

  try {
    const result = await requestUpgradePlansEmail({
      userId,
      requiredPlan: parsed.data.requiredPlan,
      featureName: parsed.data.featureName,
      featureKey: parsed.data.featureKey
    });
    return res.json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Upgrade interest email error:", error);
    return res.status(500).json({ error: "Failed to process upgrade request" });
  }
});
