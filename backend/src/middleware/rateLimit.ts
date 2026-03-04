import type { NextFunction, Request, Response } from "express";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

type CreateRateLimiterInput = {
  name: string;
  windowMs: number;
  max: number;
  message: string;
};

function getClientId(req: Request) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function createRateLimiter(input: CreateRateLimiterInput) {
  const store = new Map<string, RateLimitEntry>();
  const cleanupIntervalMs = Math.max(5_000, Math.min(60_000, input.windowMs));
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (entry.resetAt <= now) {
        store.delete(key);
      }
    }
  }, cleanupIntervalMs);
  cleanupTimer.unref?.();

  return function rateLimiter(req: Request, res: Response, next: NextFunction) {
    const now = Date.now();
    const key = `${input.name}:${getClientId(req)}`;
    const existing = store.get(key);
    const entry =
      !existing || existing.resetAt <= now
        ? { count: 0, resetAt: now + input.windowMs }
        : existing;

    entry.count += 1;
    store.set(key, entry);

    const remaining = Math.max(0, input.max - entry.count);
    res.setHeader("X-RateLimit-Limit", String(input.max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > input.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ error: input.message });
    }

    return next();
  };
}
