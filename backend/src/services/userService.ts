import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";

type IdentityInput = {
  aadOid: string;
  tenantId: string;
  email?: string;
  displayName?: string;
};

type UserRow = {
  id: string;
  organization_id: string | null;
  app_trial_started_at: string | null;
  app_trial_ends_at: string | null;
};

type DeletedUserRow = {
  id: string;
  email: string | null;
  organization_id: string | null;
};

function buildOrgSlug(prefix: string) {
  const seed = randomUUID().split("-")[0];
  return `${prefix}-${seed}`.toLowerCase();
}

const APP_TRIAL_PLAN_CODE = "basic";
const APP_TRIAL_DAYS = 30;

async function ensureAppTrialStarted(client: PoolClient, userId: string) {
  await client.query(
    `UPDATE users
     SET app_trial_started_at = COALESCE(app_trial_started_at, now()),
         app_trial_ends_at = COALESCE(app_trial_ends_at, now() + make_interval(days => $2::int)),
         app_trial_plan_code = COALESCE(app_trial_plan_code, $3),
         updated_at = now()
     WHERE id = $1`,
    [userId, APP_TRIAL_DAYS, APP_TRIAL_PLAN_CODE]
  );
}

export async function ensureUserFromIdentity(input: IdentityInput) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const found = await client.query<UserRow>(
      `SELECT id, organization_id, app_trial_started_at, app_trial_ends_at
       FROM users
       WHERE aad_oid = $1
       LIMIT 1`,
      [input.aadOid]
    );

    if ((found.rowCount ?? 0) > 0) {
      const user = found.rows[0];
      await client.query(
        `UPDATE users
         SET last_seen_at = now(),
             updated_at = now(),
             email = COALESCE($2, email),
             display_name = COALESCE($3, display_name)
         WHERE id = $1`,
        [user.id, input.email ?? null, input.displayName ?? null]
      );
      if (!user.app_trial_started_at && !user.app_trial_ends_at) {
        await ensureAppTrialStarted(client, user.id);
      }
      await client.query("COMMIT");
      return { userId: user.id, organizationId: user.organization_id };
    }

    const orgSlug = buildOrgSlug("org");
    const orgName = input.displayName ? `${input.displayName}'s Workspace` : "WisePlan Workspace";
    const orgInsert = await client.query<{ id: string }>(
      `INSERT INTO organizations(slug, name)
       VALUES ($1, $2)
       RETURNING id`,
      [orgSlug, orgName]
    );

    const organizationId = orgInsert.rows[0]?.id ?? null;
    const userInsert = await client.query<{ id: string }>(
      `INSERT INTO users(
         organization_id,
         aad_oid,
         tenant_id,
         email,
         display_name,
         app_trial_started_at,
         app_trial_ends_at,
         app_trial_plan_code
       )
       VALUES (
         $1,
         $2,
         $3,
         $4,
         $5,
         now(),
         now() + make_interval(days => $6::int),
         $7
       )
       RETURNING id`,
      [
        organizationId,
        input.aadOid,
        input.tenantId,
        input.email ?? null,
        input.displayName ?? null,
        APP_TRIAL_DAYS,
        APP_TRIAL_PLAN_CODE
      ]
    );

    const userId = userInsert.rows[0].id;

    await client.query(
      `INSERT INTO auth_identities(user_id, provider, provider_user_id, verified_email)
       VALUES ($1, 'microsoft', $2, $3)
       ON CONFLICT (provider, provider_user_id) DO NOTHING`,
      [userId, input.aadOid, input.email ?? null]
    );

    await client.query("COMMIT");
    return { userId, organizationId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteUserAccount(userId: string) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const deleted = await client.query<DeletedUserRow>(
      `DELETE FROM users
       WHERE id = $1
       RETURNING id, email, organization_id`,
      [userId]
    );

    const row = deleted.rows[0] ?? null;
    if (!row) {
      await client.query("ROLLBACK");
      return null;
    }

    if (row.organization_id) {
      await client.query(
        `DELETE FROM organizations o
         WHERE o.id = $1
           AND NOT EXISTS (
             SELECT 1
             FROM users u
             WHERE u.organization_id = o.id
           )
           AND NOT EXISTS (
             SELECT 1
             FROM subscriptions s
             WHERE s.organization_id = o.id
           )`,
        [row.organization_id]
      );
    }

    await client.query("COMMIT");
    return {
      userId: row.id,
      email: row.email
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
