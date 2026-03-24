import { Router } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/types.js";
import { appendMeetingDecisionAuditLog } from "../services/meetingDecisionAuditService.js";

const MeetingDecisionAuditBodySchema = z.object({
  entry: z.unknown(),
});

export const meetingDecisionAuditRouter = Router();

meetingDecisionAuditRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const parsed = MeetingDecisionAuditBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      issues: parsed.error.flatten(),
    });
  }

  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await appendMeetingDecisionAuditLog({
      userId,
      entry: parsed.data.entry,
    });
    return res.json({
      ok: true,
      loggedAtIso: result.loggedAtIso,
      filePath: result.filePath,
    });
  } catch (error) {
    console.error("Meeting decision audit write failed:", error);
    return res.status(500).json({
      error: "Could not write meeting decision audit log",
    });
  }
});
