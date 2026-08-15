-- The per-booking checkout configuration's own purchase_url.
--
-- Step 3 previously mounted a `chs_…` checkout SESSION. Whop's embedded checkout does not resolve
-- those ids — it renders its own 404 page — so every buyer reaching payment saw "Nothing to see
-- here yet". Proven by diffing the embed HTML per id type: a `chs_` page returns zero product
-- data, while a `plan_` or `ch_` page returns the title and price.
--
-- The flow now mints a per-booking checkout CONFIGURATION (`ch_…`) bound to the offering's
-- existing plan. Each one returns its own purchase_url carrying `?session=<that config>`, which
-- makes the §8 embed-failure fallback ATTRIBUTABLE for the first time: it carries
-- booking_intent_id, where the offering-level purchase_url carried only practitioner_id and
-- offering_id and would reconcile to no booking at all.
--
-- Additive and nullable. `whopCheckoutSessionExpiresAt` is left in place deliberately — the
-- currently-deployed build still reads it, and configurations have no expiry to record. It is
-- dropped a release later, per expand/contract.
ALTER TABLE "BookingIntent" ADD COLUMN "whopCheckoutPurchaseUrl" TEXT;

-- Clear every stored `chs_…` id. These are the broken sessions: without this, an intent minted
-- before this release keeps its unrenderable id forever (the mint is skipped when one is stored),
-- so exactly the buyers who already hit the 404 would keep hitting it. Nulling makes the flow
-- re-mint a configuration on their next visit. Scoped by prefix so a `ch_…` written by the new
-- code during a rolling deploy is left alone.
UPDATE "BookingIntent"
   SET "whopCheckoutSessionId" = NULL,
       "whopCheckoutSessionExpiresAt" = NULL
 WHERE "whopCheckoutSessionId" LIKE 'chs\_%';
