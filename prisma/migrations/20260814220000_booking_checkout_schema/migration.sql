-- Booking & checkout schema — canonical spec v2 (vault art_c688ea69482744d19c89), §2 / §17 item 2.
-- Decisions D1 (single FK, no join table), D2 (free consult IS an Offering), D3
-- (listing_visibility is general-purpose), D6 (BookingLink always practitioner-scoped),
-- D7 (acceptsPayments is one bit of intent; capability derived).
--
-- FULLY ADDITIVE. Every column is nullable or defaulted and no existing column is read
-- differently by the currently-deployed code, which expand/contract requires: this migration
-- applies during the build while the PREVIOUS deploy is still serving traffic.
--
-- ⚠️ `prisma migrate diff` emitted `DROP INDEX "Practitioner_searchText_trgm_idx";` here and it
-- has been STRIPPED BY HAND. That pg_trgm GIN index is created by raw SQL and is not declared in
-- schema.prisma, so Prisma reads it as drift and proposes dropping it on EVERY run. Applying it
-- silently kills typo-tolerant search on production. Same precedent + reasoning as
-- 20260812120000_practitioner_display_ordering. Strip it again next time.
--
-- NO Whop column is added. `whop_status` from §2 is a DERIVED display value, not storage: the
-- gate is the existing `whopPayoutsEnabled` (Whop's payout_status has NINE states, and a 3-state
-- enum would be the third generation of the mistake `whopKycStatus` already made).

-- CreateEnum
CREATE TYPE "BookingProvider" AS ENUM ('CALENDLY', 'CAL_COM', 'ACUITY', 'SAVVYCAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ListingVisibility" AS ENUM ('LISTED', 'LINK_ONLY');

-- CreateEnum
CREATE TYPE "BookingEntryPoint" AS ENUM ('BOOKING_LINK', 'OFFERING_CARD');

-- CreateEnum
CREATE TYPE "BookingIntentStatus" AS ENUM ('PENDING', 'SCHEDULED', 'PAID', 'ABANDONED');

-- CreateEnum
CREATE TYPE "ScheduleSignal" AS ENUM ('EVENT', 'SELF_REPORT', 'ASSUMED');

-- AlterTable
ALTER TABLE "BookingLink" ADD COLUMN     "ctaLabel" TEXT,
ADD COLUMN     "provider" "BookingProvider" NOT NULL DEFAULT 'OTHER';

-- AlterTable
ALTER TABLE "Practitioner" ADD COLUMN     "notificationCcEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "notifyLeadsImmediately" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "primaryBookingLinkId" TEXT;

-- AlterTable
ALTER TABLE "WhopProduct" ADD COLUMN     "acceptsPayments" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bookingLinkId" TEXT,
ADD COLUMN     "duration" INTEGER,
ADD COLUMN     "isConsult" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "listingVisibility" "ListingVisibility" NOT NULL DEFAULT 'LISTED';

-- CreateTable
CREATE TABLE "BookingIntent" (
    "id" TEXT NOT NULL,
    "practitionerId" TEXT NOT NULL,
    "bookingLinkId" TEXT,
    "offeringId" TEXT,
    "entryPoint" "BookingEntryPoint" NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "note" TEXT,
    "status" "BookingIntentStatus" NOT NULL DEFAULT 'PENDING',
    "scheduleSignal" "ScheduleSignal",
    "scheduledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingIntent_practitionerId_status_idx" ON "BookingIntent"("practitionerId", "status");

-- CreateIndex
CREATE INDEX "BookingIntent_status_createdAt_idx" ON "BookingIntent"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Practitioner_primaryBookingLinkId_key" ON "Practitioner"("primaryBookingLinkId");

-- CreateIndex
CREATE INDEX "WhopProduct_bookingLinkId_idx" ON "WhopProduct"("bookingLinkId");

-- AddForeignKey
ALTER TABLE "Practitioner" ADD CONSTRAINT "Practitioner_primaryBookingLinkId_fkey" FOREIGN KEY ("primaryBookingLinkId") REFERENCES "BookingLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhopProduct" ADD CONSTRAINT "WhopProduct_bookingLinkId_fkey" FOREIGN KEY ("bookingLinkId") REFERENCES "BookingLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingIntent" ADD CONSTRAINT "BookingIntent_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "Practitioner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingIntent" ADD CONSTRAINT "BookingIntent_bookingLinkId_fkey" FOREIGN KEY ("bookingLinkId") REFERENCES "BookingLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingIntent" ADD CONSTRAINT "BookingIntent_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "WhopProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- §2 constraint: `listing_visibility = 'link_only'` REQUIRES a booking link.
-- Enforced by construction in admin (the visibility toggle is disabled until a link is selected,
-- and clearing the link reverts to LISTED), so no user-facing validation error state is
-- reachable. This CHECK is the backstop for API and import writes that bypass the form — an
-- Offering that is hidden from the grid AND attached to no link would be reachable from nowhere
-- at all, which is unrepresentable rather than merely discouraged.
ALTER TABLE "WhopProduct"
  ADD CONSTRAINT "WhopProduct_link_only_requires_booking_link"
  CHECK ("listingVisibility" <> 'LINK_ONLY' OR "bookingLinkId" IS NOT NULL);
