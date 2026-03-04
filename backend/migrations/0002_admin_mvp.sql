-- Admin MVP support: temporary tier overrides + admin role hardening.
-- Keeps billing-independent controls while Stripe/webhook flow is not live.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'admin_allowlist_role_check'
  ) THEN
    ALTER TABLE admin_allowlist
    ADD CONSTRAINT admin_allowlist_role_check
    CHECK (role IN ('support_admin', 'super_admin'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS user_tier_overrides (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  subscription_tier TEXT NOT NULL CHECK (subscription_tier IN ('free', 'basic', 'pro', 'premium')),
  reason TEXT,
  updated_by_admin_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_tier_overrides_updated_at
  ON user_tier_overrides(updated_at DESC);
