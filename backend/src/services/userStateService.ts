import { query } from "../db/pool.js";

type UserStateRow = {
  completed_event_ids: unknown;
  day_order: unknown;
  updated_at: Date;
};

export async function getUserStateForDay(input: { userId: string; dayKey: string }) {
  const result = await query<UserStateRow>(
    `SELECT completed_event_ids, day_order, updated_at
     FROM user_app_state_daily
     WHERE user_id = $1
       AND day_key = $2::date
     LIMIT 1`,
    [input.userId, input.dayKey]
  );

  if ((result.rowCount ?? 0) === 0) {
    return {
      completedEventIds: [],
      dayOrder: [],
      updatedAt: null
    };
  }

  const row = result.rows[0];
  return {
    completedEventIds: row.completed_event_ids,
    dayOrder: row.day_order,
    updatedAt: row.updated_at
  };
}

export async function upsertUserStateForDay(input: {
  userId: string;
  dayKey: string;
  completedEventIds: string[];
  dayOrder: string[];
  source?: string;
}) {
  await query(
    `INSERT INTO user_app_state_daily(user_id, day_key, completed_event_ids, day_order, source)
     VALUES ($1, $2::date, $3::jsonb, $4::jsonb, $5)
     ON CONFLICT (user_id, day_key)
     DO UPDATE SET
       completed_event_ids = EXCLUDED.completed_event_ids,
       day_order = EXCLUDED.day_order,
       source = EXCLUDED.source,
       updated_at = now()`,
    [
      input.userId,
      input.dayKey,
      JSON.stringify(input.completedEventIds),
      JSON.stringify(input.dayOrder),
      input.source ?? "app"
    ]
  );

  return getUserStateForDay({ userId: input.userId, dayKey: input.dayKey });
}
