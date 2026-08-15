-- Exactly-once markers for §10's two outbound emails.
--
-- Resend's idempotencyKey de-duplicates for 24 HOURS and nothing more. Nothing else ever removed
-- an unpaid intent from the sweep's candidate set: the cold sweep deliberately never touches
-- SCHEDULED, and paidAt stays null forever when a buyer simply decides not to buy. So a 24h
-- window alone meant "one resume email per day, indefinitely" — a buyer who changed their mind
-- would be chased daily for the life of the row, from a sending domain whose deliverability was
-- hard-won and is trivially lost to spam complaints.
--
-- These columns also fix a starvation bug that the same missing state caused: with a `take` cap,
-- an ORDER BY createdAt ASC and no sent-marker, the oldest N eligible intents are re-selected on
-- every single run and intent N+1 is never reached at all — not "deferred", never.
--
-- Both additive and nullable; the currently-deployed code reads neither.
ALTER TABLE "BookingIntent" ADD COLUMN "resumeEmailSentAt" TIMESTAMP(3);
ALTER TABLE "BookingIntent" ADD COLUMN "scheduledNoticeSentAt" TIMESTAMP(3);
