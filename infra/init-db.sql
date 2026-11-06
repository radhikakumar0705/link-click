-- link-click database initialisation (runs once, on the Postgres container's first start).
--
-- The schema is owned entirely by Prisma migrations (migrations/). Run:
--   npm run migrate:deploy
--
-- This file used to create a partitioned `clicks` table here. That collided
-- with the Prisma migration (which creates `clicks` too) and never ran on
-- Supabase, so dev and production had different schemas. Partitioning is
-- planned as a dedicated migration; see docs/DESIGN.md.
SELECT 1;
