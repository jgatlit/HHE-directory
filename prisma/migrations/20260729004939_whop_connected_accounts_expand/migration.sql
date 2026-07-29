-- AlterTable
ALTER TABLE "Practitioner" ADD COLUMN     "whopCompanyCreatedAt" TIMESTAMP(3),
ADD COLUMN     "whopIdentityProfileId" TEXT,
ADD COLUMN     "whopPayoutStatus" TEXT NOT NULL DEFAULT 'not_started',
ADD COLUMN     "whopPayoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whopSubscriptionCheckoutUrl" TEXT;

