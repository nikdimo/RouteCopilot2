import { Router } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/types.js";
import {
  FeatureNotIncludedError,
  SettingsAccessLockedError
} from "../services/featureAccessService.js";
import {
  getUserProfileSettings,
  updateUserProfileSettings
} from "../services/profileSettingsService.js";

const hhmmRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

const workingDaysSchema = z.tuple([
  z.boolean(),
  z.boolean(),
  z.boolean(),
  z.boolean(),
  z.boolean(),
  z.boolean(),
  z.boolean()
]);

const profileSettingsPatchSchema = z
  .object({
    workingHours: z
      .object({
        start: z.string().regex(hhmmRegex).optional(),
        end: z.string().regex(hhmmRegex).optional()
      })
      .optional(),
    preMeetingBuffer: z.number().int().min(0).max(240).optional(),
    postMeetingBuffer: z.number().int().min(0).max(240).optional(),
    homeBase: z
      .object({
        lat: z.number().finite(),
        lon: z.number().finite()
      })
      .nullable()
      .optional(),
    homeBaseLabel: z.string().trim().max(300).nullable().optional(),
    workingDays: workingDaysSchema.optional(),
    distanceThresholdKm: z.number().finite().min(0).max(1000).optional(),
    alwaysStartFromHomeBase: z.boolean().optional(),
    useGoogleGeocoding: z.boolean().optional(),
    useTrafficAwareRouting: z.boolean().optional(),
    googleMapsApiKey: z.string().trim().max(500).nullable().optional(),
    calendarConnected: z.boolean().optional(),
    calendarProvider: z.enum(["outlook"]).nullable().optional()
  })
  .refine(
    (value) =>
      value.workingHours !== undefined ||
      value.preMeetingBuffer !== undefined ||
      value.postMeetingBuffer !== undefined ||
      value.homeBase !== undefined ||
      value.homeBaseLabel !== undefined ||
      value.workingDays !== undefined ||
      value.distanceThresholdKm !== undefined ||
      value.alwaysStartFromHomeBase !== undefined ||
      value.useGoogleGeocoding !== undefined ||
      value.useTrafficAwareRouting !== undefined ||
      value.googleMapsApiKey !== undefined ||
      value.calendarConnected !== undefined ||
      value.calendarProvider !== undefined,
    {
      message: "At least one setting must be provided"
    }
  );

export const profileSettingsRouter = Router();

profileSettingsRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const data = await getUserProfileSettings(userId);
    return res.json(data);
  } catch (error) {
    console.error("Profile settings read error:", error);
    return res.status(500).json({ error: "Failed to load profile settings" });
  }
});

profileSettingsRouter.patch("/", async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = profileSettingsPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      issues: parsed.error.flatten()
    });
  }

  try {
    const data = await updateUserProfileSettings(userId, parsed.data, "app");
    return res.json(data);
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

    console.error("Profile settings update error:", error);
    return res.status(500).json({ error: "Failed to update profile settings" });
  }
});
