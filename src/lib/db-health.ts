import { prisma } from '@/lib/prisma';

/**
 * Is the production database healthy, current, and lossless?
 *
 * This exists to GATE SNAPSHOT ROTATION. The rotation deletes the previous snapshot before taking
 * a new one (Neon's Free plan allows exactly one manual snapshot), so there is a moment with no
 * snapshot at all. If the live database were already damaged when that ran, we would delete the
 * only good copy and replace it with a snapshot OF THE DAMAGE — converting a recoverable incident
 * into permanent loss.
 *
 * That is not hypothetical here. On 2026-08-27 a `prisma migrate diff --shadow-database-url`
 * pointed at production dropped every table; the site 500'd for ~3 hours and was recovered only
 * because a pre-incident copy still existed. A rotation running blind during that window would
 * have destroyed the recovery path.
 *
 * ⚠️ THE FLOOR IS "IS IT PLAUSIBLY INTACT", NOT "IS IT EXACTLY RIGHT". Every check below must fail
 * only on real damage. A check that trips on ordinary change (a practitioner deleted, a slow week
 * of bookings) would block snapshots indefinitely and quietly leave us with a stale one — the same
 * end state as no gate at all, but harder to notice.
 */
export type DbHealth = {
  healthy: boolean;
  /** Human-readable reasons the database looks damaged. Empty when healthy. */
  failures: string[];
  counts: Record<string, number>;
  /** Present but non-fatal — worth reporting, not worth blocking on. */
  warnings: string[];
};

/**
 * Minimum row counts consistent with a live directory. Deliberately far below actual values
 * (15 practitioners, 17 users at time of writing) so ordinary attrition never trips the gate.
 * Zero is the signal that matters: it is what a wipe looks like.
 */
const FLOORS = { Practitioner: 1, User: 1, Specialty: 1 } as const;

export async function checkDbHealth(): Promise<DbHealth> {
  const failures: string[] = [];
  const warnings: string[] = [];
  const counts: Record<string, number> = {};

  // 1 — CORE TABLES EXIST AND ARE NON-EMPTY. A wipe shows up here first: the tables are gone
  // entirely, so these throw rather than return 0.
  try {
    const [practitioners, users, specialties, intents, links] = await Promise.all([
      prisma.practitioner.count(),
      prisma.user.count(),
      prisma.specialty.count(),
      prisma.bookingIntent.count(),
      prisma.bookingLink.count(),
    ]);
    Object.assign(counts, {
      Practitioner: practitioners,
      User: users,
      Specialty: specialties,
      BookingIntent: intents,
      BookingLink: links,
    });
    for (const [table, floor] of Object.entries(FLOORS)) {
      if ((counts[table] ?? 0) < floor) {
        failures.push(`${table} has ${counts[table]} rows (floor ${floor}) — looks wiped`);
      }
    }
  } catch (err) {
    failures.push(
      `core tables unreadable: ${err instanceof Error ? err.message : String(err)} — ` +
        'a missing relation is what a dropped schema looks like',
    );
  }

  // 2 — THE MIGRATION LEDGER IS INTACT AND NOT MID-FAILURE. A partially-applied migration is
  // exactly the state we must not immortalise in a snapshot.
  try {
    const rows = await prisma.$queryRaw<{ total: bigint; unfinished: bigint; rolled_back: bigint }[]>`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE finished_at IS NULL)      AS unfinished,
             count(*) FILTER (WHERE rolled_back_at IS NOT NULL) AS rolled_back
      FROM "_prisma_migrations"`;
    const m = rows[0];
    counts._prisma_migrations = Number(m?.total ?? 0);
    if (!m || Number(m.total) === 0) failures.push('_prisma_migrations is empty — schema is not baselined');
    if (m && Number(m.unfinished) > 0) failures.push(`${m.unfinished} migration(s) never finished`);
    if (m && Number(m.rolled_back) > 0) failures.push(`${m.rolled_back} migration(s) rolled back`);
  } catch (err) {
    failures.push(`_prisma_migrations unreadable: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3 — THE pg_trgm TRIGRAM INDEX. Raw SQL, absent from schema.prisma, so NOTHING else in the
  // repo would notice its loss — and `prisma migrate diff` proposes dropping it on every run.
  // Losing it silently removes search typo tolerance. A WARNING, not a failure: search degrades,
  // data does not, and blocking snapshots over it would be the wrong trade.
  try {
    const idx = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE indexname = 'Practitioner_searchText_trgm_idx'`;
    if (idx.length === 0) {
      warnings.push('Practitioner_searchText_trgm_idx is MISSING — search typo tolerance is gone');
    }
  } catch {
    warnings.push('could not verify the pg_trgm index');
  }

  return { healthy: failures.length === 0, failures, counts, warnings };
}
