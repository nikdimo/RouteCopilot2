import { Router } from "express";
import { getPublicPlansCatalog } from "../services/billingService.js";

export const publicRouter = Router();

publicRouter.get("/plans", async (_req, res) => {
  try {
    const plans = await getPublicPlansCatalog();
    return res.json(plans);
  } catch (error) {
    console.error("Public plans error:", error);
    return res.status(500).json({
      error: "Failed to load public plans"
    });
  }
});
