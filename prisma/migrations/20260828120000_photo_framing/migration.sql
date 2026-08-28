-- Non-destructive photo framing: a focal point + zoom, applied at render time via CSS
-- object-position/scale. The image file itself is never rewritten.
--
-- EXPAND-ONLY AND SAFE UNDER expand/contract. All three columns are NOT NULL with defaults that
-- reproduce the CURRENT rendering exactly (centre crop, no magnification), so:
--   * this migration applies during the build while the PREVIOUS deploy is still serving, and
--     that older code — which selects none of these columns — is entirely unaffected;
--   * every existing row is already correct on arrival. No backfill, no follow-up migration.

-- AlterTable
ALTER TABLE "Practitioner" ADD COLUMN     "photoFocalX" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
ADD COLUMN     "photoFocalY" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
ADD COLUMN     "photoZoom" DOUBLE PRECISION NOT NULL DEFAULT 1.0;

