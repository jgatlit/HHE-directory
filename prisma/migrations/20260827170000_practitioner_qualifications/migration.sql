-- Qualifications / certifications & education on the practitioner profile.
--
-- Replaces the redundant right-pane specialties list (Amy's 08-17 interface review).
--
-- EXPAND-ONLY. Migrations auto-apply during the Vercel build while the PREVIOUS deploy is still
-- serving traffic, so this must not break code that knows nothing about the column — an added,
-- defaulted column cannot.
--
-- The explicit empty-array DEFAULT is not redundant with Prisma's read behaviour: it makes an
-- existing practitioner read as "no credentials stated" at the SQL level too, so a report or an
-- import that bypasses Prisma sees the same thing the app does rather than a NULL.

-- AlterTable
ALTER TABLE "Practitioner" ADD COLUMN     "qualifications" TEXT[] DEFAULT ARRAY[]::TEXT[];
