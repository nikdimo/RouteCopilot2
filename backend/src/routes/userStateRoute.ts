import { Router } from "express";
import { z } from "zod";
import { getUserStateForDay, upsertUserStateForDay } from "../services/userStateService.js";
import type { AuthenticatedRequest } from "../middleware/types.js";

function isValidDayKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [yearStr, monthStr, dayStr] = value.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  return (
    utcDate.getUTCFullYear() === year &&
    utcDate.getUTCMonth() === month - 1 &&
    utcDate.getUTCDate() === day
  );
}

const dayKeySchema = z.string().refine(isValidDayKey, {
  message: "Expected dayKey in YYYY-MM-DD format"
});

const UserStateBodySchema = z.object({
  dayKey: dayKeySchema,
  completedEventIds: z.array(z.string().min(1).max(300)).max(2000).default([]),
  dayOrder: z.array(z.string().min(1).max(300)).max(2000).default([])
});

export const userStateRouter = Router();

userStateRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const parsed = dayKeySchema.safeParse(req.query.dayKey);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid or missing dayKey query parameter (expected YYYY-MM-DD)"
    });
  }

  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const state = await getUserStateForDay({
    userId,
    dayKey: parsed.data
  });

  return res.json({
    dayKey: parsed.data,
    ...state
  });
});

userStateRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const parsed = UserStateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      issues: parsed.error.flatten()
    });
  }

  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const state = await upsertUserStateForDay({
    userId,
    dayKey: parsed.data.dayKey,
    completedEventIds: parsed.data.completedEventIds,
    dayOrder: parsed.data.dayOrder
  });

  return res.json({
    dayKey: parsed.data.dayKey,
    ...state
  });
});
