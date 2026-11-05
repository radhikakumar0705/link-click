-- link-click database initialisation
-- This script runs once on first container start.
-- Prisma handles most schema creation via migrations;
-- this file handles partitioned table setup that Prisma cannot express declaratively.

-- ── Partitioned clicks table ──────────────────────────────────────────────────
-- Prisma models the `clicks` table as a regular table for type-safe queries.
-- In production, we replace it with this partitioned version.
-- Partitions are created monthly by the background jobs service.

-- Drop the Prisma-created version and replace with partitioned form:
-- (This is safe on first init; migration tooling handles upgrades)

CREATE TABLE IF NOT EXISTS clicks (
  id              BIGSERIAL,
  short_code      VARCHAR(12) NOT NULL,
  clicked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_hash         CHAR(64),
  user_agent      TEXT,
  country         CHAR(2),
  city            VARCHAR(100),
  device_type     VARCHAR(20),
  browser         VARCHAR(50),
  os              VARCHAR(50),
  referrer        TEXT,
  referrer_domain VARCHAR(100),
  is_unique       BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (id, clicked_at)
) PARTITION BY RANGE (clicked_at);

-- Create the current month's partition
DO $$
DECLARE
  start_date DATE := DATE_TRUNC('month', CURRENT_DATE);
  end_date   DATE := start_date + INTERVAL '1 month';
  partition_name TEXT := 'clicks_' || TO_CHAR(start_date, 'YYYY_MM');
BEGIN
  EXECUTE FORMAT(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF clicks FOR VALUES FROM (%L) TO (%L)',
    partition_name, start_date, end_date
  );
END $$;

-- Index on the partition key for fast range scans
CREATE INDEX IF NOT EXISTS idx_clicks_short_code_clicked_at
  ON clicks(short_code, clicked_at DESC);
