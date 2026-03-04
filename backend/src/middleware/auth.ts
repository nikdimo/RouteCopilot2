import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { NextFunction, Response } from "express";
import { env, azureIssuer, azureJwksUri } from "../config/env.js";
import type { AuthenticatedRequest } from "./types.js";
import { ensureUserFromIdentity } from "../services/userService.js";

const jwks = createRemoteJWKSet(new URL(azureJwksUri));

function isPostgresErrorCode(value: unknown): value is string {
  return typeof value === "string" && /^[0-9A-Z]{5}$/.test(value);
}

function getBearerToken(header?: string) {
  if (!header) {
    return null;
  }
  const [scheme, token] = header.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }
  return token;
}

async function verifyAzureToken(token: string) {
  const result = await jwtVerify(token, jwks, {
    issuer: azureIssuer,
    audience: env.AZURE_AUDIENCE
  });
  return result.payload;
}

async function verifyMagicToken(token: string) {
  const secret = new TextEncoder().encode(env.MAGIC_LINK_JWT_SECRET ?? "");
  const result = await jwtVerify(token, secret, {
    issuer: env.MAGIC_LINK_TOKEN_ISSUER,
    audience: env.MAGIC_LINK_TOKEN_AUDIENCE,
    algorithms: ["HS256"]
  });
  return result.payload;
}

function extractIdentity(payload: JWTPayload) {
  const aadOid = typeof payload.oid === "string" ? payload.oid : undefined;
  const tenantId = typeof payload.tid === "string" ? payload.tid : undefined;

  if (!aadOid || !tenantId) {
    throw new Error("Token missing required claims: oid/tid");
  }

  const email =
    typeof payload.preferred_username === "string"
      ? payload.preferred_username
      : typeof payload.email === "string"
        ? payload.email
        : undefined;
  const displayName = typeof payload.name === "string" ? payload.name : undefined;

  return { aadOid, tenantId, email, displayName };
}

function extractMagicIdentity(payload: JWTPayload) {
  const emailRaw =
    typeof payload.email === "string"
      ? payload.email
      : typeof payload.preferred_username === "string"
        ? payload.preferred_username
        : typeof payload.sub === "string" && payload.sub.includes("@")
          ? payload.sub
          : undefined;

  if (!emailRaw) {
    throw new Error("Magic token missing email claim");
  }

  const email = emailRaw.trim().toLowerCase();
  const displayName =
    typeof payload.name === "string" && payload.name.trim().length > 0
      ? payload.name.trim()
      : email.split("@")[0] ?? "WisePlan User";

  return {
    aadOid: `magic:${email}`,
    tenantId: "magic-auth",
    email,
    displayName
  };
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    if (env.AUTH_MODE === "dev") {
      const user = await ensureUserFromIdentity({
        aadOid: env.DEV_AUTH_AAD_OID,
        tenantId: env.DEV_AUTH_TENANT_ID
      });
      req.auth = {
        userId: user.userId,
        aadOid: env.DEV_AUTH_AAD_OID,
        tenantId: env.DEV_AUTH_TENANT_ID,
        displayName: "Dev User"
      };
      return next();
    }

    const token = getBearerToken(req.header("authorization"));
    if (!token) {
      return res.status(401).json({ error: "Missing Bearer token" });
    }

    const payload =
      env.AUTH_MODE === "magic" ? await verifyMagicToken(token) : await verifyAzureToken(token);
    const identity = env.AUTH_MODE === "magic" ? extractMagicIdentity(payload) : extractIdentity(payload);
    const user = await ensureUserFromIdentity(identity);

    req.auth = {
      userId: user.userId,
      aadOid: identity.aadOid,
      tenantId: identity.tenantId,
      email: identity.email,
      displayName: identity.displayName
    };

    return next();
  } catch (error) {
    const code = (error as { code?: unknown } | null | undefined)?.code;
    if (isPostgresErrorCode(code)) {
      console.error("Auth backend error:", error);
      return res.status(500).json({ error: "Auth backend error" });
    }

    console.error("Auth error:", error);
    return res.status(401).json({ error: "Unauthorized" });
  }
}
