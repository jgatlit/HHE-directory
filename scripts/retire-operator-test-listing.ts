/**
 * STAGED — needs operator sign-off. DRY RUN BY DEFAULT; --apply is the only thing that writes.
 *
 *   npx tsx --env-file=.env scripts/retire-operator-test-listing.ts            # report only
 *   npx tsx --env-file=.env scripts/retire-operator-test-listing.ts --apply    # write + reindex
 *
 * WHAT THIS IS FOR
 * The operator's onboarding test account (jgatlit+onboard1@gmail.com, "Jonathan Gudger |
 * aiChemist") is a fully listed practitioner: it is the most recently accepted row, so
 * `orderBy: { acceptedAt: 'desc' }` hands it the lead card on the public home page of a
 * holistic-health directory. It also drags its intake taxonomy — "Business process
 * automation", "AI systems integration" — into the live /search facet list.
 *
 * This is a DATA problem, not a code problem. The account's user role is PRACTITIONER, not
 * ADMIN (ADMIN_EMAILS is matched on the exact address and does not contain the +onboard1
 * alias), so no role-based query filter reaches it, and the only role-based filter that
 * would compile drops Amy's real listing instead. See the report for that analysis.
 *
 * WHY trialEndsAt IS THE LEVER
 * isListed() = complete AND (ACTIVE | PAST_DUE | trial-active | owner is ADMIN). This row is
 * complete, subscriptionStatus NONE, trialEndsAt 2026-10-27 — so it is listed purely on the
 * trial clock. Backdating that one column unlists it everywhere (home featured, home count,
 * /search) while destroying nothing: the profile stays complete, /practitioners/<slug> still
 * resolves (direct URLs are deliberately exempt from the listing gate), and the live Whop
 * connected account biz_8RDm3wyLlTRUPy stays attached so the payments E2E fixture survives.
 * One column, one value, trivially reversible — as against deleting the row or blanking the
 * bio, which would take the fixture and the profile copy with it.
 *
 * WHY IT ALSO REINDEXES
 * Typesense is push-based: nothing re-evaluates the listing gate on a clock. A SQL date flip
 * alone leaves the document sitting in the index looking live. --apply therefore calls
 * indexPractitioner(), which re-runs isListed() and deletes the doc.
 *
 * WHY THE SPECIALTY CLEANUP DETACHES RATHER THAN RE-STATUSES
 * SpecialtyStatus is only ACTIVE | PROPOSED | MERGED, and nothing in the indexer reads
 * status — toTypesenseDoc() emits every linked specialty's name into `specialtyNames`
 * regardless. So flipping status would not remove these from the facet list. Only detaching
 * the PractitionerSpecialty rows does. The Specialty + alias rows are left in place: they are
 * harmless once unlinked, and deleting them would cascade.
 */
import { PrismaClient } from '@prisma/client';
import { indexPractitioner, listedWhere } from '../src/lib/practitioner-indexer';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

/**
 * Operator decision 2026-08-10: both operator profiles are unlisted via step 2 alone — detaching
 * their specialties fails `specialties: { some: {} }` in listedWhere(), which is ANDed, so the
 * ADMIN exemption in its OR branch cannot rescue them. That makes the trial backdate redundant,
 * and actively unhelpful: jgatlit-onboard1 is being KEPT for developer testing and holds the live
 * Whop connected account, so parking it in an expired-trial state would distort the very
 * trial/subscription flows it exists to exercise. Opt in with --backdate-trial if that changes.
 */
const BACKDATE_TRIAL = process.argv.includes('--backdate-trial');

const TEST_ACCOUNT_EMAIL = 'jgatlit+onboard1@gmail.com';

/**
 * Non-holistic taxonomy that entered the live catalog through operator/test intake only.
 * `business-process-automation` is the one named in the defect report; the other two are the
 * same leak from the same two profiles and are listed here for the operator to accept or
 * strike before applying.
 */
const OPERATOR_TAXONOMY_SLUGS = [
  'business-process-automation',
  'ai-systems-integration',
  'agentic-workflow-design',
];

function line() {
  console.log('─'.repeat(78));
}

async function main() {
  console.log(APPLY ? '*** APPLY — this run WRITES ***\n' : 'DRY RUN — no writes. Re-run with --apply to commit.\n');

  // ── 1. the test listing ────────────────────────────────────────────────────────────────
  line();
  console.log(`1. Backdate the test practitioner's trial  [${BACKDATE_TRIAL ? 'ENABLED' : 'SKIPPED — step 2 already unlists it'}]`);
  line();

  const target = BACKDATE_TRIAL ? await prisma.practitioner.findFirst({
    where: { user: { email: TEST_ACCOUNT_EMAIL } },
    select: {
      id: true,
      slug: true,
      displayName: true,
      acceptedAt: true,
      trialEndsAt: true,
      subscriptionStatus: true,
      whopCompanyId: true,
      user: { select: { email: true, role: true } },
    },
  }) : null;

  if (!target) {
    console.log(
      BACKDATE_TRIAL
        ? `  no practitioner owned by ${TEST_ACCOUNT_EMAIL} — nothing to do.`
        : '  trialEndsAt left untouched, so trial/subscription testing on this account is unaffected.',
    );
  } else {
    const backdated = new Date(Date.now() - 24 * 60 * 60 * 1000);
    console.log(`  ${target.displayName}  (/practitioners/${target.slug})`);
    console.log(`    owner            ${target.user.email}  [role ${target.user.role}]`);
    console.log(`    acceptedAt       ${target.acceptedAt?.toISOString() ?? 'null'}`);
    console.log(`    subscription     ${target.subscriptionStatus}`);
    console.log(`    whopCompanyId    ${target.whopCompanyId ?? 'null'}   (PRESERVED — not touched)`);
    console.log('');
    console.log(`    WOULD SET  trialEndsAt: ${target.trialEndsAt?.toISOString() ?? 'null'}  ->  ${backdated.toISOString()}`);
    console.log('    WOULD THEN indexPractitioner() -> drops the Typesense doc');
    console.log('');
    const listedNow = await prisma.practitioner.count({ where: listedWhere() });
    const nextLead = await prisma.practitioner.findFirst({
      where: { AND: [listedWhere(), { id: { not: target.id } }] },
      orderBy: { acceptedAt: 'desc' },
      select: { displayName: true, slug: true },
    });
    console.log(`    EFFECT   home featured rail: card removed (lead card becomes ${nextLead?.displayName ?? 'n/a'})`);
    console.log(`             home count:         "N HHE-trained practitioners" ${listedNow} -> ${listedNow - 1}`);
    console.log('             /search:            1 fewer hit; its facet values lose 1 count');
    console.log(`             /practitioners/${target.slug}: still resolves (direct URLs are exempt)`);
    console.log('');
    console.log(`    REVERT   set trialEndsAt back to ${target.trialEndsAt?.toISOString() ?? 'null'} and reindex.`);

    if (APPLY) {
      await prisma.practitioner.update({ where: { id: target.id }, data: { trialEndsAt: backdated } });
      await indexPractitioner(target.id);
      console.log('\n    APPLIED + reindexed.');
    }
  }

  // ── 2. the taxonomy leak ───────────────────────────────────────────────────────────────
  console.log('');
  line();
  console.log('2. Detach operator/test taxonomy from practitioner profiles');
  line();

  const specialties = await prisma.specialty.findMany({
    where: { slug: { in: OPERATOR_TAXONOMY_SLUGS } },
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      practitioners: {
        select: {
          rawLabel: true,
          practitioner: { select: { id: true, slug: true, user: { select: { email: true } } } },
        },
      },
    },
  });

  const missing = OPERATOR_TAXONOMY_SLUGS.filter((s) => !specialties.some((f) => f.slug === s));
  if (missing.length) console.log(`  not present in the catalog (already gone?): ${missing.join(', ')}\n`);

  const touchedPractitionerIds = new Set<string>();
  for (const s of specialties) {
    console.log(`  "${s.name}"  [${s.slug}, status ${s.status}]  — ${s.practitioners.length} link(s)`);
    for (const link of s.practitioners) {
      touchedPractitionerIds.add(link.practitioner.id);
      console.log(
        `    WOULD DELETE PractitionerSpecialty  ${link.practitioner.slug} <-> ${s.slug}` +
          `   (rawLabel: ${link.rawLabel ?? 'null'}, owner ${link.practitioner.user.email})`,
      );
    }
    console.log(`    Specialty row + its aliases: LEFT IN PLACE (deleting would cascade).`);
    console.log('');
  }

  // A profile that ends up with zero specialties fails the completeness gate and unlists.
  for (const id of Array.from(touchedPractitionerIds)) {
    const remaining = await prisma.practitionerSpecialty.count({
      where: { practitionerId: id, specialty: { slug: { notIn: OPERATOR_TAXONOMY_SLUGS } } },
    });
    const p = await prisma.practitioner.findUnique({ where: { id }, select: { slug: true } });
    console.log(
      `  after detach, ${p?.slug} keeps ${remaining} specialty(ies)` +
        (remaining === 0 ? '  <-- becomes INCOMPLETE and therefore UNLISTED' : ''),
    );
  }

  if (APPLY && specialties.length) {
    const res = await prisma.practitionerSpecialty.deleteMany({
      where: { specialty: { slug: { in: OPERATOR_TAXONOMY_SLUGS } } },
    });
    console.log(`\n  APPLIED — deleted ${res.count} PractitionerSpecialty row(s).`);
    for (const id of Array.from(touchedPractitionerIds)) await indexPractitioner(id);
    console.log('  reindexed every affected practitioner.');
  }

  console.log('');
  if (!APPLY) console.log('DRY RUN complete — nothing was written.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
