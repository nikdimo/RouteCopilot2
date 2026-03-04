import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { adminRouter } from "./adminRoute.js";
import { authRouter, meRouter } from "./authRoute.js";
import { billingRouter, billingWebhookRouter } from "./billingRoute.js";
import { featureRouter } from "./featureRoute.js";
import { geocodeRouter } from "./geocodeRoute.js";
import { profileSettingsRouter } from "./profileSettingsRoute.js";
import { publicRouter } from "./publicRoute.js";
import { routeRouter } from "./routeRoute.js";
import { upgradeInterestRouter } from "./upgradeInterestRoute.js";
import { userStateRouter } from "./userStateRoute.js";

export const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
  return res.json({
    ok: true
  });
});

apiRouter.use("/public", publicRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/billing", billingWebhookRouter);

apiRouter.use(requireAuth);
apiRouter.use("/me", meRouter);
apiRouter.use("/me/features", featureRouter);
apiRouter.use("/me/profile-settings", profileSettingsRouter);
apiRouter.use("/me/upgrade-interest", upgradeInterestRouter);
apiRouter.use("/geocode", geocodeRouter);
apiRouter.use("/route", routeRouter);
apiRouter.use("/user/state", userStateRouter);
apiRouter.use("/billing", billingRouter);
apiRouter.use("/admin", adminRouter);
