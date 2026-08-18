-- Operator directory controls for /admin/invites: delist (hide from discovery, stays bookable)
-- and archive (soft delete, preserves booking intents and payment records).
--
-- Purely additive: two nullable columns, no backfill, no default. Safe under the expand/contract
-- rule this repo's build requires — `prisma migrate deploy` runs during the build while the
-- PREVIOUS deploy is still serving traffic, and code that has never heard of these columns is
-- unaffected by them existing.
--
-- NOTE: `prisma migrate diff` also proposes `DROP INDEX "Practitioner_searchText_trgm_idx"`.
-- That is DELIBERATELY OMITTED. The pg_trgm GIN index is created by raw SQL in an earlier
-- migration and cannot be expressed in schema.prisma, so every future diff will keep proposing
-- to drop it. Dropping it would silently remove typo tolerance from search. Never accept it.
-- AlterTable
ALTER TABLE "Practitioner" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "delistedAt" TIMESTAMP(3);
