-- "otongan" was renamed to "otonan" via an in-place edit of 001, which never
-- re-applies to databases already at version 1. Rebuild the table with the
-- corrected CHECK and convert existing rows. Ids are preserved, so rows in
-- notification_log that reference occasions keep pointing at the same ids.
CREATE TABLE occasions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('birthday','otonan','anniversary')),
  base_date TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT ''
);
INSERT INTO occasions_new (id, contact_id, type, base_date, label)
SELECT id, contact_id, CASE type WHEN 'otongan' THEN 'otonan' ELSE type END, base_date, label
FROM occasions;
DROP TABLE occasions;
ALTER TABLE occasions_new RENAME TO occasions;
CREATE INDEX idx_occasions_contact ON occasions(contact_id);
