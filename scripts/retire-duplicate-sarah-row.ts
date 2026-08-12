/**
 * STAGED — operator-approved 2026-08-12 ("Sarah: retire the old row").
 * DRY RUN BY DEFAULT; --apply is the only thing that writes.
 *
 *   npx tsx --env-file=.env scripts/retire-duplicate-sarah-row.ts            # report only
 *   npx tsx --env-file=.env scripts/retire-duplicate-sarah-row.ts --apply    # write + reindex
 *
 * ⚠️ RUN ONLY AFTER THE feat/practitioner-ordering MIGRATION HAS DEPLOYED.
 * --apply calls indexPractitioner(), which reads PractitionerSpecialty.sortOrder. That column
 * arrives with migration 20260812120000_practitioner_display_ordering, applied by the build.
 * Running --apply against a database that predates it fails on P2022 partway through. The dry
 * run is safe at any time — it selects explicitly and never touches the indexer.
 *
 * WHAT HAPPENED
 * Sarah Schindler exists twice. The 2026-05-29 pilot import created `sarah-schindler` against
 * hello@livingaligned.love. On the 2026-08-11 onboarding call she reported that address was dead
 * ("my email is not even accurate, it doesn't even work anymore"), Jonathan issued a fresh invite
 * to sarah@wild-rooted.com, and she onboarded end-to-end under it — producing a SECOND row,
 * `sarah`, because practitioner records are keyed on userId and that was a new user.
 *
 * The outcome is backwards: the stale row is the one the public sees.
 *
 *   sarah-schindler  hello@livingaligned.love  LISTED      no offerings, no booking link, no Whop
 *   sarah            sarah@wild-rooted.com     NOT LISTED  3 offerings, Acuity link, Whop account
 *
 * `sarah` is unlisted for one reason: cityId is null, which fails isProfileComplete() and so
 * isListed(). She selected a city during the call and it never persisted — the profile form had
 * no dirty-state indication and its only Save sat far below the fold (both fixed in this branch).
 *
 * WHICH ROW WINS, AND WHY IT IS NOT CLOSE
 * `sarah` carries 10 specialties to the old row's 3, a live Acuity consultation link, three real
 * offerings (Root Cause Release $55, 1:1 Session $10, Human Design Session $200), the connected
 * Whop account biz_xExE1eUWG4ZMeR, her current site (wild-rooted.com, not livingaligned.love) and
 * her current positioning. The old row leads on "Cognitive Parenting Coach" — the emphasis she
 * said on the call she was moving away from for this audience. The only thing it holds that the
 * new row lacks is the city.
 *
 * SO THE FIX IS THREE WRITES
 *   1. carry the city across  — Virtual Practice / Online, which is what she chose on the call
 *      and matches "I don't work in person". This alone makes `sarah` listed.
 *   2. null `sarah`.trialEndsAt — it was stamped 2026-11-09 at onboarding, which contradicts the
 *      operator ruling that the pilot runs indefinitely until live production is switched on.
 *   3. retire `sarah-schindler` by backdating its trialEndsAt, which unlists it everywhere.
 *
 * WHY BACKDATING RATHER THAN DELETING
 * Same lever, same reasoning as retire-operator-test-listing.ts. isListed() is
 * complete AND (ACTIVE | PAST_DUE | trial-active | ADMIN); this row is complete with
 * subscriptionStatus NONE, so the trial clock is the only thing listing it, and one column
 * removes it from the home page, the directory count and /search. Nothing is destroyed: the
 * profile stays intact, /practitioners/sarah-schindler still resolves (direct URLs are
 * deliberately exempt from the listing gate), and the whole thing is reversible by clearing one
 * field. Deleting would cascade the specialty rows and orphan the User.
 *
 * The semantics are imperfect and worth naming: this row is a RETIRED DUPLICATE, not an expired
 * trial, and the dashboard would call it "Pilot ended" to anyone who logged in. Nobody can — the
 * address is dead, which is the whole reason the duplicate exists.
 *
 * WHY IT REINDEXES
 * Typesense is push-based; nothing re-evaluates the listing gate on a clock. Without an explicit
 * reindex the old document sits in the index looking live and the new one never appears. The
 * reindex is also the assertion: `sarah` must become listed and `sarah-schindler` must drop out.
 * If either doesn't, that is a real finding and this is where you want to learn it.
 */
import { PrismaClient } from '@prisma/client';
import { indexPractitioner, isListed } from '../src/lib/practitioner-indexer';

const RETIRE_SLUG = 'sarah-schindler';
const KEEP_SLUG = 'sarah';

const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();

// Explicit select: the generated client may be ahead of the deployed database (see the header
// note on sortOrder), and `include` would request every column.
const SELECT = {
  id: true,
  slug: true,
  displayName: true,
  cityId: true,
  bio: true,
  trialEndsAt: true,
  subscriptionStatus: true,
  whopCompanyId: true,
  city: { select: { id: true, name: true, state: true } },
  specialties: { select: { specialtyId: true } },
  bookingLinks: { select: { url: true } },
  whopProducts: { select: { title: true } },
  user: { select: { email: true, role: true } },
} as const;

async function main() {
  const rows = await prisma.practitioner.findMany({
    where: { slug: { in: [RETIRE_SLUG, KEEP_SLUG] } },
    select: SELECT,
  });
  const retire = rows.find((r) => r.slug === RETIRE_SLUG);
  const keep = rows.find((r) => r.slug === KEEP_SLUG);

  if (!retire || !keep) {
    console.error(`Expected both rows. found: ${rows.map((r) => r.slug).join(', ') || 'none'}`);
    process.exitCode = 1;
    return;
  }

  for (const r of [retire, keep]) {
    console.log(
      `[${r.slug}] ${r.user.email}\n` +
        `  listed=${isListed(r as never)}  city=${r.city ? `${r.city.name}, ${r.city.state}` : 'NONE'}  ` +
        `specialties=${r.specialties.length}  offerings=${r.whopProducts.length}  ` +
        `booking=${r.bookingLinks.length}  whop=${r.whopCompanyId ?? 'none'}  ` +
        `trialEndsAt=${r.trialEndsAt?.toISOString() ?? 'null'}`,
    );
  }

  if (!retire.cityId) {
    console.error(`\n${RETIRE_SLUG} has no city to carry across — resolve by hand.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n${apply ? 'APPLY' : 'DRY RUN'} — planned writes:`);
  console.log(`  ${KEEP_SLUG}.cityId      : ${keep.cityId ?? 'null'} -> ${retire.cityId}`);
  console.log(`  ${KEEP_SLUG}.trialEndsAt : ${keep.trialEndsAt?.toISOString() ?? 'null'} -> null`);
  console.log(`  ${RETIRE_SLUG}.trialEndsAt : ${retire.trialEndsAt?.toISOString() ?? 'null'} -> 1970-01-01 (unlist)`);

  if (keep.cityId && keep.cityId !== retire.cityId) {
    console.log(`\n  NOTE: ${KEEP_SLUG} already has a different city — it will be OVERWRITTEN.`);
  }

  if (!apply) {
    console.log('\nNothing written. Re-run with --apply.');
    return;
  }

  await prisma.$transaction([
    prisma.practitioner.update({
      where: { id: keep.id },
      data: { cityId: retire.cityId, trialEndsAt: null },
    }),
    prisma.practitioner.update({
      where: { id: retire.id },
      data: { trialEndsAt: new Date(0) },
    }),
  ]);
  console.log('\nWrites committed.');

  await indexPractitioner(keep.id);
  await indexPractitioner(retire.id);

  // Assert the outcome rather than trusting the writes.
  const after = await prisma.practitioner.findMany({
    where: { slug: { in: [RETIRE_SLUG, KEEP_SLUG] } },
    select: SELECT,
  });
  let ok = true;
  for (const r of after) {
    const listed = isListed(r as never);
    const expected = r.slug === KEEP_SLUG;
    if (listed !== expected) ok = false;
    console.log(`  ${r.slug}: listed=${listed} (expected ${expected}) ${listed === expected ? '✓' : '✗'}`);
  }
  if (!ok) {
    console.error('\n⚠️  Listing state is not what was intended. Investigate before telling anyone.');
    process.exitCode = 1;
  } else {
    console.log('\nDone — the correct row is live and the duplicate is retired.');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
