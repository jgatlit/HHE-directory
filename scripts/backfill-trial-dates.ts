/**
 * GO-LIVE LEVER — starts the 90-day pilot clock for everyone at once.
 * DRY RUN BY DEFAULT; --apply is the only thing that writes.
 *
 *   npx tsx --env-file=.env scripts/backfill-trial-dates.ts            # report only
 *   npx tsx --env-file=.env scripts/backfill-trial-dates.ts --apply    # write + reindex
 *
 * WHY THIS EXISTS
 * `src/app/onboarding/page.tsx` has referenced this path in a "keep in sync" comment since the
 * trial clock shipped, but the file was never written. That mattered on 2026-08-12, when the
 * operator ruled that the pilot runs INDEFINITELY until live production is switched on: the
 * ruling is only safe if the thing that ends the pilot actually exists. Without it, "we'll start
 * the clock later" is a promise with no mechanism.
 *
 * HOW THE PILOT IS HELD OPEN
 * Onboarding leaves `trialEndsAt` null while `PILOT_TRIAL_CLOCK_ENABLED` is unset. isListed()
 * already reads null as pre-trial-and-listed, so nobody is gated and no new listing logic was
 * needed. Going live is two steps, in this order:
 *
 *   1. set PILOT_TRIAL_CLOCK_ENABLED=true in Vercel (so NEW practitioners start their own clock
 *      at their own onboarding), then redeploy
 *   2. run this with --apply (so EXISTING pre-trial practitioners all start together, today)
 *
 * Running step 2 first is harmless but incomplete — anyone onboarding between the two steps
 * would land pre-trial and need a second pass.
 *
 * WHO IS TOUCHED
 * Only practitioners with `trialEndsAt === null` AND `subscriptionStatus === 'NONE'`. That is
 * deliberate on both counts:
 *   - a non-null date means their clock is already running (or has run) — never restart it, that
 *     would silently extend or revive an expired trial
 *   - a paying/past-due practitioner has no use for a trial date, and stamping one on them makes
 *     the dashboard read as a trial to someone who is already a customer
 * Admins are skipped: isListed() exempts them outright, so a clock on an admin row is noise that
 * shows a countdown badge to staff.
 *
 * WHY IT ALSO REINDEXES
 * Typesense is push-based — nothing re-evaluates the listing gate on a clock. These rows stay
 * listed after the write (a future trialEndsAt is trial-active), so no document should change,
 * and the reindex is a cheap assertion of exactly that. If a row DID drop out, that is a real
 * finding and this is where you want to learn it, not 90 days later.
 */
import { PrismaClient } from '@prisma/client';
import { indexPractitioner } from '../src/lib/practitioner-indexer';

// Mirrors TRIAL_DAYS in src/app/onboarding/page.tsx. Kept as a literal rather than imported:
// that module is a Next server component and pulls the auth stack in with it.
const TRIAL_DAYS = 90;

const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();

async function main() {
  const trialEndsAt = new Date();
  trialEndsAt.setUTCDate(trialEndsAt.getUTCDate() + TRIAL_DAYS);

  const candidates = await prisma.practitioner.findMany({
    where: {
      trialEndsAt: null,
      subscriptionStatus: 'NONE',
      user: { role: { not: 'ADMIN' } },
    },
    select: { id: true, slug: true, displayName: true, acceptedAt: true },
    orderBy: { acceptedAt: 'asc' },
  });

  console.log(`${apply ? 'APPLY' : 'DRY RUN'} — pilot clock start`);
  console.log(`trialEndsAt would be set to: ${trialEndsAt.toISOString()}`);
  console.log(`pre-trial practitioners found: ${candidates.length}\n`);

  for (const c of candidates) {
    console.log(`  ${c.slug.padEnd(28)} ${c.displayName}`);
  }

  if (!apply) {
    console.log('\nNothing written. Re-run with --apply to start the clock.');
    return;
  }

  if (candidates.length === 0) {
    console.log('\nNothing to do.');
    return;
  }

  const { count } = await prisma.practitioner.updateMany({
    where: { id: { in: candidates.map((c) => c.id) } },
    data: { trialEndsAt },
  });
  console.log(`\nUpdated ${count} practitioner(s).`);

  // Assert the listing gate still holds. A future trialEndsAt is trial-active, so every one of
  // these should stay indexed — a drop here means the gate disagrees with this script and wants
  // investigating before anyone is billed.
  let reindexed = 0;
  for (const c of candidates) {
    await indexPractitioner(c.id);
    reindexed++;
  }
  console.log(`Reindexed ${reindexed} practitioner(s).`);

  if (count !== candidates.length) {
    console.error(
      `\n⚠️  Expected to update ${candidates.length} but updated ${count}. Investigate before going live.`,
    );
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
