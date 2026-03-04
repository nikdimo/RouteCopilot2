-- Persist profile settings server-side and add app trial metadata.
-- This enables strict "active plan/trial required" profile-setting writes.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS app_trial_started_at TIMESTAMPTZ;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS app_trial_ends_at TIMESTAMPTZ;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS app_trial_plan_code TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_app_trial_plan_code_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_app_trial_plan_code_check
      CHECK (
        app_trial_plan_code IS NULL
        OR app_trial_plan_code IN ('free', 'basic', 'pro', 'premium')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_app_trial_ends_at
  ON users(app_trial_ends_at DESC);

CREATE TABLE IF NOT EXISTS user_profile_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  working_hours_start TEXT NOT NULL DEFAULT '08:00',
  working_hours_end TEXT NOT NULL DEFAULT '17:00',
  pre_meeting_buffer_minutes INTEGER NOT NULL DEFAULT 15 CHECK (pre_meeting_buffer_minutes >= 0 AND pre_meeting_buffer_minutes <= 240),
  post_meeting_buffer_minutes INTEGER NOT NULL DEFAULT 15 CHECK (post_meeting_buffer_minutes >= 0 AND post_meeting_buffer_minutes <= 240),
  home_base_lat DOUBLE PRECISION,
  home_base_lon DOUBLE PRECISION,
  home_base_label TEXT,
  working_days JSONB NOT NULL DEFAULT '[false,true,true,true,true,true,false]'::jsonb,
  distance_threshold_km NUMERIC(8,2) NOT NULL DEFAULT 30 CHECK (distance_threshold_km >= 0 AND distance_threshold_km <= 1000),
  always_start_from_home_base BOOLEAN NOT NULL DEFAULT true,
  use_advanced_geocoding BOOLEAN NOT NULL DEFAULT false,
  use_traffic_routing BOOLEAN NOT NULL DEFAULT false,
  google_maps_api_key TEXT,
  calendar_connected BOOLEAN NOT NULL DEFAULT false,
  calendar_provider TEXT,
  last_calendar_sync_at TIMESTAMPTZ,
  updated_by_source TEXT NOT NULL DEFAULT 'app',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_profile_settings_calendar_provider_check
    CHECK (calendar_provider IS NULL OR calendar_provider IN ('outlook'))
);

CREATE INDEX IF NOT EXISTS idx_user_profile_settings_updated_at
  ON user_profile_settings(updated_at DESC);

-- Backfill feature toggles so existing users keep their backend toggle state.
INSERT INTO user_profile_settings(user_id, use_advanced_geocoding, use_traffic_routing, updated_by_source)
SELECT p.user_id, p.use_advanced_geocoding, p.use_traffic_routing, 'migration-0005'
FROM user_feature_preferences p
ON CONFLICT (user_id) DO UPDATE
SET use_advanced_geocoding = EXCLUDED.use_advanced_geocoding,
    use_traffic_routing = EXCLUDED.use_traffic_routing,
    updated_by_source = EXCLUDED.updated_by_source,
    updated_at = now();
