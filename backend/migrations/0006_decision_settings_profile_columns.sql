-- Add decision-tuning profile fields:
-- - far_detour_override_min_savings_minutes
-- - meeting_duration_preset_{1,2,3}_minutes

ALTER TABLE user_profile_settings
  ADD COLUMN IF NOT EXISTS far_detour_override_min_savings_minutes INTEGER NOT NULL DEFAULT 20
    CHECK (far_detour_override_min_savings_minutes >= 0 AND far_detour_override_min_savings_minutes <= 240);

ALTER TABLE user_profile_settings
  ADD COLUMN IF NOT EXISTS meeting_duration_preset_1_minutes INTEGER NOT NULL DEFAULT 30
    CHECK (
      meeting_duration_preset_1_minutes >= 15
      AND meeting_duration_preset_1_minutes <= 480
      AND meeting_duration_preset_1_minutes % 15 = 0
    );

ALTER TABLE user_profile_settings
  ADD COLUMN IF NOT EXISTS meeting_duration_preset_2_minutes INTEGER NOT NULL DEFAULT 60
    CHECK (
      meeting_duration_preset_2_minutes >= 15
      AND meeting_duration_preset_2_minutes <= 480
      AND meeting_duration_preset_2_minutes % 15 = 0
    );

ALTER TABLE user_profile_settings
  ADD COLUMN IF NOT EXISTS meeting_duration_preset_3_minutes INTEGER NOT NULL DEFAULT 90
    CHECK (
      meeting_duration_preset_3_minutes >= 15
      AND meeting_duration_preset_3_minutes <= 480
      AND meeting_duration_preset_3_minutes % 15 = 0
    );
