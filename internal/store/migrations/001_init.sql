CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  nickname TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_contacts_owner ON contacts(owner_id);

CREATE TABLE occasions (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  recurrence TEXT NOT NULL CHECK (recurrence IN ('once','yearly','monthly','anniversary','otonan')),
  base_date TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_occasions_contact ON occasions(contact_id);

CREATE TABLE reminder_prefs (
  contact_id TEXT PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
  offsets TEXT NOT NULL,
  channel_ids TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE occasion_prefs (
  occasion_id TEXT PRIMARY KEY REFERENCES occasions(id) ON DELETE CASCADE,
  offsets TEXT NOT NULL,
  channel_ids TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('gotify','telegram','email')),
  name TEXT NOT NULL,
  config_enc BLOB NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE notification_log (
  id TEXT PRIMARY KEY,
  occasion_id TEXT REFERENCES occasions(id) ON DELETE SET NULL,
  holiday_key TEXT,
  occurrence_date TEXT NOT NULL,
  offset_days INTEGER NOT NULL,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('sent','failed','missed')),
  error TEXT NOT NULL DEFAULT '',
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX uq_log_occasion ON notification_log(occasion_id, occurrence_date, offset_days, channel_id) WHERE occasion_id IS NOT NULL;
CREATE UNIQUE INDEX uq_log_holiday ON notification_log(holiday_key, occurrence_date, offset_days, channel_id) WHERE holiday_key IS NOT NULL;
CREATE INDEX idx_log_sent_at ON notification_log(sent_at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE holiday_cache (
  year INTEGER NOT NULL,
  source TEXT NOT NULL,
  payload TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (year, source)
);
