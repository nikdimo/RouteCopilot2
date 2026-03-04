import { Router, type Response } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import type { AuthenticatedRequest } from "../middleware/types.js";
import {
  BillingError,
  completeMockCheckoutForUser,
  createCheckoutSessionForUser,
  createPortalSessionForUser,
  getBillingSnapshot,
  listInvoicesForUser,
  processBillingWebhook,
  validatePromotionForUser
} from "../services/billingService.js";

const planCodeSchema = z.enum(["free", "basic", "pro", "premium"]);
const billingIntervalSchema = z.enum(["monthly", "annual"]);

const checkoutBodySchema = z.object({
  planCode: planCodeSchema,
  billingInterval: billingIntervalSchema,
  currency: z.string().trim().toLowerCase().max(10).optional(),
  promoCode: z.string().trim().max(100).optional(),
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
  source: z.string().trim().max(60).optional(),
  feature: z.string().trim().max(120).optional()
});

const promoValidateBodySchema = z.object({
  code: z.string().trim().min(1).max(100),
  planCode: planCodeSchema,
  billingInterval: billingIntervalSchema,
  currency: z.string().trim().toLowerCase().max(10).optional(),
  region: z.string().trim().toLowerCase().max(20).optional()
});

const invoiceQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

const mockCompleteBodySchema = z.object({
  checkoutSessionId: z.string().trim().min(8).max(200)
});

function sendBillingError(
  res: Response,
  error: unknown
) {
  if (error instanceof BillingError) {
    return res.status(error.status).json({
      error: error.message,
      ...(error.details ? { details: error.details } : {})
    });
  }
  console.error("Billing route error:", error);
  return res.status(500).json({ error: "Billing request failed" });
}

export const billingWebhookRouter = Router();
export const billingRouter = Router();
const billingRateLimiter = createRateLimiter({
  name: "billing",
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_BILLING_MAX,
  message: "Too many billing requests. Please try again shortly."
});
const billingWebhookRateLimiter = createRateLimiter({
  name: "billing-webhook",
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_WEBHOOK_MAX,
  message: "Too many webhook requests."
});

billingWebhookRouter.use(billingWebhookRateLimiter);
billingRouter.use(billingRateLimiter);

billingWebhookRouter.post("/webhook", async (req, res) => {
  try {
    const rawBody = (req as { rawBody?: Buffer }).rawBody;
    const signatureHeader = req.header("stripe-signature") ?? undefined;
    const result = await processBillingWebhook({
      rawBody,
      signatureHeader,
      payload: req.body
    });
    return res.json(result);
  } catch (error) {
    return sendBillingError(res, error);
  }
});

billingRouter.get("/me", async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const snapshot = await getBillingSnapshot(userId);
    return res.json(snapshot);
  } catch (error) {
    return sendBillingError(res, error);
  }
});

billingRouter.post("/promo/validate", async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = promoValidateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      issues: parsed.error.flatten()
    });
  }

  try {
    const result = await validatePromotionForUser(userId, parsed.data);
    return res.json(result);
  } catch (error) {
    return sendBillingError(res, error);
  }
});

billingRouter.post("/checkout-session", async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = checkoutBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      issues: parsed.error.flatten()
    });
  }

  const headerIdempotencyKey = req.header("idempotency-key")?.trim();
  const idempotencyKey = parsed.data.idempotencyKey ?? headerIdempotencyKey;
  if (!idempotencyKey) {
    return res.status(400).json({ error: "Missing idempotency key" });
  }

  try {
    const result = await createCheckoutSessionForUser(userId, {
      ...parsed.data,
      idempotencyKey
    });
    return res.json(result);
  } catch (error) {
    return sendBillingError(res, error);
  }
});

billingRouter.post("/customer-portal-session", async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await createPortalSessionForUser(userId);
    return res.json(result);
  } catch (error) {
    return sendBillingError(res, error);
  }
});

billingRouter.get("/invoices", async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = invoiceQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid query",
      issues: parsed.error.flatten()
    });
  }

  try {
    const invoices = await listInvoicesForUser(userId, parsed.data.limit);
    return res.json({ invoices });
  } catch (error) {
    return sendBillingError(res, error);
  }
});

billingRouter.post("/mock/complete-checkout", async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = mockCompleteBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      issues: parsed.error.flatten()
    });
  }

  try {
    const snapshot = await completeMockCheckoutForUser(userId, parsed.data.checkoutSessionId);
    return res.json(snapshot);
  } catch (error) {
    return sendBillingError(res, error);
  }
});
