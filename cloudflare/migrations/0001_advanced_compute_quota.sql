-- MABRIG StatLab pilot compute quota only.
-- Do not store case data, source CSV, Access JWT, email, user name, or model outputs.
-- Apply manually to a dedicated pilot D1 database, then bind ADVANCED_USAGE_DB.
CREATE TABLE IF NOT EXISTS statlab_compute_usage (
  subject_hash TEXT NOT NULL,
  day TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0 CHECK (requests >= 0),
  PRIMARY KEY(subject_hash, day)
);
CREATE INDEX IF NOT EXISTS statlab_compute_usage_day_idx ON statlab_compute_usage(day);
-- Daily cleanup (optional, operator-reviewed): DELETE FROM statlab_compute_usage WHERE day < 'YYYY-MM-DD';
