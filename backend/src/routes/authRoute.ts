import { Router } from "express";
import { createRequire } from "node:module";
import { SignJWT } from "jose";
import { env } from "../config/env.js";
import { query } from "../db/pool.js";
import type { AuthenticatedRequest } from "../middleware/types.js";
import { deleteUserAccount } from "../services/userService.js";

export const authRouter = Router();
export const meRouter = Router();
const require = createRequire(import.meta.url);

type MailTransport = {
  sendMail: (input: Record<string, unknown>) => Promise<unknown>;
};

let cachedTransport: MailTransport | null | undefined;

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function buildNativeMagicLink(token: string) {
  return `wiseplan://auth?token=${encodeURIComponent(token)}`;
}

function buildWebMagicLink(token: string) {
  const target = new URL(env.MAGIC_LINK_WEB_URL);
  target.searchParams.set("token", token);
  return target.toString();
}

async function buildMagicToken(email: string) {
  const secret = new TextEncoder().encode(env.MAGIC_LINK_JWT_SECRET ?? "dev-magic-secret");
  const displayName = email.split("@")[0] ?? "WisePlan User";
  return new SignJWT({
    email,
    preferred_username: email,
    name: displayName
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(env.MAGIC_LINK_TOKEN_ISSUER)
    .setAudience(env.MAGIC_LINK_TOKEN_AUDIENCE)
    .setSubject(email)
    .setIssuedAt()
    .setExpirationTime(`${env.MAGIC_LINK_TOKEN_TTL_MINUTES}m`)
    .sign(secret);
}

function hasSmtpConfig() {
  return Boolean(env.MAGIC_LINK_SMTP_HOST && env.MAGIC_LINK_SMTP_USER && env.MAGIC_LINK_SMTP_PASS);
}

async function getTransport(): Promise<MailTransport | null> {
  if (!hasSmtpConfig()) return null;
  if (cachedTransport !== undefined) {
    return cachedTransport;
  }
  try {
    const nodemailer = require("nodemailer") as {
      createTransport: (input: Record<string, unknown>) => MailTransport;
    };
    cachedTransport = nodemailer.createTransport({
      host: env.MAGIC_LINK_SMTP_HOST,
      port: env.MAGIC_LINK_SMTP_PORT,
      secure: env.MAGIC_LINK_SMTP_SECURE,
      auth: {
        user: env.MAGIC_LINK_SMTP_USER,
        pass: env.MAGIC_LINK_SMTP_PASS
      }
    });
    return cachedTransport;
  } catch (error) {
    console.error("Magic link mailer init failed:", error);
    cachedTransport = null;
    return null;
  }
}

async function sendMagicLinkEmail(input: { to: string; magicLinkUrl: string; token: string }) {
  const transport = await getTransport();
  if (!transport) return false;

  const fromHeader = `${env.MAGIC_LINK_FROM_NAME} <${env.MAGIC_LINK_FROM_EMAIL}>`;
  const nativeMagicLink = buildNativeMagicLink(input.token);
  const text = [
    "Your WisePlan sign-in link:",
    input.magicLinkUrl,
    "",
    "This link expires soon. If you did not request it, you can ignore this email.",
    "",
    `Optional app link: ${nativeMagicLink}`
  ].join("\n");
  const html = `
    <p>Your WisePlan sign-in link:</p>
    <p><a href="${input.magicLinkUrl}">${input.magicLinkUrl}</a></p>
    <p>This link expires soon. If you did not request it, you can ignore this email.</p>
    <p style="color:#64748b;font-size:12px;">Optional app link: ${nativeMagicLink}</p>
  `;

  await transport.sendMail({
    from: fromHeader,
    to: input.to,
    replyTo: env.MAGIC_LINK_REPLY_TO ?? undefined,
    subject: "Your WisePlan sign-in link",
    text,
    html
  });
  return true;
}

authRouter.post("/request-magic-link", async (req, res) => {
  const email =
    typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Valid email is required" });
  }

  try {
    if (env.AUTH_MODE !== "dev" && !hasSmtpConfig()) {
      return res.status(500).json({
        error: "Magic link email is not configured on server."
      });
    }

    const token = await buildMagicToken(email);
    const magicLinkUrl = buildWebMagicLink(token);
    let emailSent = false;
    if (hasSmtpConfig()) {
      try {
        emailSent = await sendMagicLinkEmail({ to: email, magicLinkUrl, token });
      } catch (error) {
        console.error("Magic link send failed:", error);
        if (env.AUTH_MODE !== "dev") {
          return res.status(502).json({ error: "Could not send magic link. Please try again." });
        }
      }
    }

    if (env.AUTH_MODE !== "dev" && !emailSent) {
      return res.status(502).json({ error: "Could not send magic link. Please try again." });
    }

    if (env.AUTH_MODE === "dev") {
      return res.json({
        success: true,
        token,
        magicLinkUrl,
        nativeMagicLinkUrl: buildNativeMagicLink(token),
        emailSent
      });
    }

    return res.json({
      success: true
    });
  } catch (error) {
    console.error("Magic link request failed:", error);
    return res.status(500).json({ error: "Could not process magic link request." });
  }
});

meRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const found = await query<{
      id: string;
      organization_id: string | null;
      email: string | null;
      display_name: string | null;
      created_at: string;
      last_seen_at: string;
    }>(
      `SELECT id, organization_id, email, display_name, created_at, last_seen_at
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [userId]
    );

    const row = found.rows[0];
    if (!row) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json({
      id: row.id,
      organizationId: row.organization_id,
      email: row.email,
      name: row.display_name,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at
    });
  } catch (error) {
    console.error("Me route error:", error);
    return res.status(500).json({ error: "Failed to load user profile" });
  }
});

meRouter.delete("/account", async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const deleted = await deleteUserAccount(userId);
    if (!deleted) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json({
      ok: true,
      deletedUserId: deleted.userId,
      deletedEmail: deleted.email
    });
  } catch (error) {
    console.error("Account deletion failed:", error);
    return res.status(500).json({ error: "Failed to delete account" });
  }
});
