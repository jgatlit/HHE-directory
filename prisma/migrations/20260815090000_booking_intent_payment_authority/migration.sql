-- Payment authority for the booking flow (§17.3c).
--
-- `whopCheckoutSessionId` — the session minted for this intent. Previously a session was minted
-- on EVERY render of a public, unauthenticated, force-dynamic page, including branches that never
-- used it; and a buyer who refreshed mid-payment got a brand-new session, i.e. a second chargeable
-- checkout. Storing it makes the mint once-per-intent and lets a refresh resume the same session.
--
-- `paidAt` — written by the `payment.succeeded` webhook, which is the only party that can prove a
-- payment happened. Until this migration the ONLY writer of PAID was a public unauthenticated
-- server action taking the two values printed in the URL, so anyone holding a booking link could
-- record a sale that never occurred.
--
-- Both additive and nullable; nothing in the currently-deployed code reads either.
ALTER TABLE "BookingIntent" ADD COLUMN "whopCheckoutSessionId" TEXT;
ALTER TABLE "BookingIntent" ADD COLUMN "paidAt" TIMESTAMP(3);
