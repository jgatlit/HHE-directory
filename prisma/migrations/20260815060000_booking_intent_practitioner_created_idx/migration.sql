-- The capture route's per-practitioner burst bound counts BookingIntent rows on
-- (practitionerId, createdAt), on the critical path of every submission to a route that
-- §17.4a just linked from every profile.
--
-- Neither existing index covers that pair: @@index([practitionerId, status]) can use only its
-- practitionerId prefix and must then heap-fetch and filter every row on createdAt, and
-- @@index([status, createdAt]) is the wrong leading column. BookingIntent rows are never deleted
-- — §10 sweeps by status, not by removal — so the scan grows monotonically with a practitioner's
-- lifetime lead count.
--
-- Additive and non-blocking to read traffic.
CREATE INDEX "BookingIntent_practitionerId_createdAt_idx"
  ON "BookingIntent"("practitionerId", "createdAt");
