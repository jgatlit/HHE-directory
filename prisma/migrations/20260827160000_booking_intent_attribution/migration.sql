-- Lead attribution snapshotted onto BookingIntent at row creation (§16, D14).
--
-- EXPAND-ONLY AND FULLY NULLABLE, deliberately. Migrations auto-apply during the Vercel build
-- while the PREVIOUS deploy is still serving traffic and still inserting BookingIntent rows that
-- know nothing about these columns. A NOT NULL or a required default here would fail every
-- booking capture for the length of the deploy.
--
-- Nothing is backfilled. Null honestly means "no first touch was ever resolved for this row",
-- which is true of every booking taken before this shipped, and is distinguishable from a
-- resolved attribution of either party.

-- CreateEnum
CREATE TYPE "LeadAttributionParty" AS ENUM ('PRACTITIONER', 'NHP');

-- AlterTable
ALTER TABLE "BookingIntent" ADD COLUMN     "attribution" JSONB,
ADD COLUMN     "attributionParty" "LeadAttributionParty",
ADD COLUMN     "attributionSource" TEXT;
