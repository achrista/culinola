-- One row per installation. No IP address, no request data.
CREATE TABLE IF NOT EXISTS installs (
  id TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  pings INTEGER NOT NULL,
  version TEXT NOT NULL,
  os TEXT NOT NULL,
  arch TEXT NOT NULL,
  docker INTEGER NOT NULL,
  demo INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS installs_last_seen ON installs (last_seen);
