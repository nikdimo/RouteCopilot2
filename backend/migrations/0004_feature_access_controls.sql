-- Feature-access controls and provider metadata.
-- Supports server-owned feature toggles (advanced geocoding, traffic routing)
-- and route cache separation by provider mode.

CREATE TABLE IF NOT EXISTS user_feature_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  use_advanced_geocoding BOOLEAN NOT NULL DEFAULT false,
  use_traffic_routing BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_feature_preferences_updated_at
  ON user_feature_preferences(updated_at DESC);

ALTER TABLE route_cache
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'osrm';

ALTER TABLE route_cache
  ADD COLUMN IF NOT EXISTS traffic_aware BOOLEAN NOT NULL DEFAULT false;
