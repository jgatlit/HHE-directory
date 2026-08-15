-- Data migration: an offering that was already PUBLISHED had its intent expressed under the old
-- model, before `acceptsPayments` existed.
--
-- §9 derives capability as `acceptsPayments && payouts_enabled && whopPlanId != null`. The column
-- landed in 20260814220000 defaulting to false, so migrating the public Buy CTA onto that rule
-- without this would silently switch OFF every offering that is live and selling today —
-- including the first purchasable offering on the platform, published 2026-08-14.
--
-- Minting a Whop plan is not something that happens by accident: `publishOffering` is an explicit
-- practitioner action behind a hard payouts gate. A non-null `whopPlanId` therefore IS the intent
-- bit, recorded before there was a column to record it in. This backfills it rather than asking
-- practitioners to re-express a decision they already made.
--
-- Deliberately narrow: only rows that carry a plan id. An offering that was never published stays
-- false, which is the correct default for intent nobody has expressed.
UPDATE "WhopProduct"
SET "acceptsPayments" = true
WHERE "whopPlanId" IS NOT NULL
  AND "acceptsPayments" = false;
