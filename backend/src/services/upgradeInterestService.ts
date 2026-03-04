import { createRequire } from "node:module";
import { env } from "../config/env.js";
import { query } from "../db/pool.js";

type UpgradeRequiredPlan = "basic" | "pro" | "premium";

type MailTransport = {
  sendMail: (input: Record<string, unknown>) => Promise<unknown>;
};

type UpgradeInterestInput = {
  userId: string;
  requiredPlan: UpgradeRequiredPlan;
  featureName?: string;
  featureKey?: string;
};

type UpgradeInterestResult = {
  emailed: boolean;
  email: string | null;
  requiredPlan: UpgradeRequiredPlan;
  featureName: string | null;
  featureKey: string | null;
};

type UserEmailRow = {
  email: string | null;
  display_name: string | null;
};

const require = createRequire(import.meta.url);
let cachedTransport: MailTransport | null | undefined;

function hasSmtpConfig() {
  return Boolean(
    env.MAGIC_LINK_SMTP_HOST &&
      env.MAGIC_LINK_SMTP_USER &&
      env.MAGIC_LINK_SMTP_PASS
  );
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
    console.error("Upgrade mailer init failed:", error);
    cachedTransport = null;
    return null;
  }
}

function toPlanLabel(plan: UpgradeRequiredPlan) {
  if (plan === "premium") return "Premium";
  if (plan === "pro") return "Pro";
  return "Basic";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function requestUpgradePlansEmail(
  input: UpgradeInterestInput
): Promise<UpgradeInterestResult> {
  const found = await query<UserEmailRow>(
    `SELECT email, display_name
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [input.userId]
  );
  const user = found.rows[0];
  if (!user) {
    throw new Error("User not found");
  }

  const email = user.email?.trim().toLowerCase() ?? null;
  const featureName = input.featureName?.trim() || null;
  const featureKey = input.featureKey?.trim() || null;

  if (!email) {
    return {
      emailed: false,
      email: null,
      requiredPlan: input.requiredPlan,
      featureName,
      featureKey
    };
  }

  const transport = await getTransport();
  if (!transport) {
    return {
      emailed: false,
      email,
      requiredPlan: input.requiredPlan,
      featureName,
      featureKey
    };
  }

  const planLabel = toPlanLabel(input.requiredPlan);
  const recipientName =
    user.display_name?.trim().length ? user.display_name.trim() : "there";
  const featureLine = featureName
    ? `Feature requested: ${featureName}`
    : "Feature requested from your profile settings";
  const plansUrl = env.BILLING_UPGRADE_URL;

  const text = [
    `Hi ${recipientName},`,
    "",
    `Thanks for using WisePlan. ${featureLine}.`,
    `This feature requires the ${planLabel} plan.`,
    "",
    "You can compare plans and choose an upgrade here:",
    plansUrl,
    "",
    "If you already upgraded, sign out and sign in again to refresh access.",
    "",
    "WisePlan Team"
  ].join("\n");

  const html = `
    <p>Hi ${escapeHtml(recipientName)},</p>
    <p>Thanks for using WisePlan.</p>
    <p>${escapeHtml(featureLine)}.<br/>This feature requires the <strong>${escapeHtml(
      planLabel
    )}</strong> plan.</p>
    <p>You can compare plans and choose an upgrade here:<br/>
    <a href="${escapeHtml(plansUrl)}">${escapeHtml(plansUrl)}</a></p>
    <p>If you already upgraded, sign out and sign in again to refresh access.</p>
    <p>WisePlan Team</p>
  `;

  const fromHeader = `${env.MAGIC_LINK_FROM_NAME} <${env.MAGIC_LINK_FROM_EMAIL}>`;
  await transport.sendMail({
    from: fromHeader,
    to: email,
    replyTo: env.MAGIC_LINK_REPLY_TO ?? undefined,
    subject: `WisePlan plans: ${planLabel} required`,
    text,
    html
  });

  return {
    emailed: true,
    email,
    requiredPlan: input.requiredPlan,
    featureName,
    featureKey
  };
}
