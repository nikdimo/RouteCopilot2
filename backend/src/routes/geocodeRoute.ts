import { Router } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/types.js";
import { getUserFeatureAccess } from "../services/featureAccessService.js";
import { resolveGeocode } from "../services/geocodeService.js";

const GeocodeBodySchema = z.object({
  address: z.string().min(3).max(500),
  countryCode: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{2}$/)
    .optional()
});

export const geocodeRouter = Router();

geocodeRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const parsed = GeocodeBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      issues: parsed.error.flatten()
    });
  }

  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const featureAccess = await getUserFeatureAccess(userId);
    const result = await resolveGeocode(parsed.data, {
      useAdvancedGeocoding: featureAccess.effective.advancedGeocodingEnabled
    });
    if (!result) {
      return res.status(404).json({
        error: "Address not found"
      });
    }
    return res.json({
      ...result,
      advancedGeocodingEnabled: featureAccess.effective.advancedGeocodingEnabled
    });
  } catch (error) {
    console.error("Geocode error:", error);
    return res.status(502).json({
      error: "Geocode provider failed"
    });
  }
});
