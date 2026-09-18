-- Custom becomes an explicit flag: a row can exist with custom=0 holding
-- retained offsets/channel_ids that reactivate when custom flips back to 1.
-- Every pre-existing row was created by the old toggle-on path → default 1.
ALTER TABLE occasion_prefs ADD COLUMN custom INTEGER NOT NULL DEFAULT 1;
