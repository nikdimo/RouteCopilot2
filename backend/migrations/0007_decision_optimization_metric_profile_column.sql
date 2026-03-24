-- Add metric selector for scheduler optimization basis.
-- 'minutes' keeps current behavior; 'km' optimizes/scores by distance deltas.

ALTER TABLE user_profile_settings
  ADD COLUMN IF NOT EXISTS decision_optimization_metric TEXT NOT NULL DEFAULT 'minutes';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_profile_settings_decision_optimization_metric_check'
  ) THEN
    ALTER TABLE user_profile_settings
      ADD CONSTRAINT user_profile_settings_decision_optimization_metric_check
      CHECK (decision_optimization_metric IN ('minutes', 'km'));
  END IF;
END $$;
