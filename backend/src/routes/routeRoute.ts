import { Router } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/types.js";
import { getUserFeatureAccess } from "../services/featureAccessService.js";
import { resolveRoute } from "../services/routeService.js";

const WaypointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180)
});

const RouteBodySchema = z.object({
  profile: z.string().default("driving"),
  waypoints: z.array(WaypointSchema).min(2).max(25)
});

export const routeRouter = Router();

routeRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const parsed = RouteBodySchema.safeParse(req.body);
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
    const result = await resolveRoute(parsed.data, {
      useTrafficAwareRouting: featureAccess.effective.trafficRoutingEnabled
    });
    return res.json(result);
  } catch (error) {
    console.error("Route error:", error);
    return res.status(502).json({
      error: "Route provider failed"
    });
  }
});
