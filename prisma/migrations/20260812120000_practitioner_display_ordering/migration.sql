-- Practitioner-controlled display ordering for offerings + specialties.
-- Reported by Sarah Schindler 2026-08-12: offerings and specialties list in an order she cannot
-- control. Two distinct causes — see docs/2026-08-12-booking-checkout-flow.md §Ordering:
--   * WhopProduct           — not random, INVERTED (dashboard sorted desc, public profile asc)
--   * PractitionerSpecialty — genuinely non-deterministic (no ordering column, no ORDER BY anywhere)
--
-- Both columns are additive with a default, so this is expand-only: it applies during the build
-- while the previous deploy is still serving, and the currently-live code ignores the new columns.

-- AlterTable
ALTER TABLE "WhopProduct" ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PractitionerSpecialty" ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- NOTE: `prisma migrate diff` additionally emits `DROP INDEX "Practitioner_searchText_trgm_idx";`
-- for every diff — that pg_trgm GIN index is created by raw SQL and is not declared in
-- schema.prisma, so Prisma reads it as drift. It is deliberately NOT included here; applying it
-- would silently kill typo-tolerant search on production.
-- See memory: gotcha_prisma_migrate_dev_broken (step 4).
