-- Analytics queries filter clicks by short_code and a clicked_at range.
-- IF NOT EXISTS: local databases created by the old infra/init-db.sql already have it.
CREATE INDEX IF NOT EXISTS "idx_clicks_short_code_clicked_at" ON "clicks"("short_code", "clicked_at" DESC);
