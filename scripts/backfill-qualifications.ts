/**
 * Populate `Practitioner.qualifications` from each practitioner's OWN existing profile text.
 *
 * ⚠️ WHY THIS EXISTS RATHER THAN "Draft my profile with AI".
 *
 * The `/edit` AI-draft action is the only other path that writes qualifications, and it is
 * DESTRUCTIVE to everything else on the profile: it overwrites `headline`, `tagline`, `whoIHelp`
 * and `bio`, and it runs `deleteMany` on the practitioner's `PractitionerSpecialty` and
 * `CaseStudy` rows before recreating them from the draft. Running it to fill one empty column
 * would discard Sarah Schindler's hand-written bio and 11 curated specialties. That is the
 * correct behaviour for a practitioner re-drafting their own profile, and the wrong tool
 * entirely for an operator backfill.
 *
 * This script reuses the SAME extraction (so the strictly-extractive rule and its tests still
 * apply) and then writes exactly ONE column. Nothing else on the row is touched.
 *
 * SAFETY
 *   - DRY RUN by default. Pass `--apply` to write.
 *   - Never overwrites a practitioner who already has qualifications (pass `--force` to allow).
 *   - Prints every proposed value for review before anything is written.
 *   - Requires ONBOARDING_LLM_API_KEY; without it `draftProfile` falls back to the template path,
 *     which by design extracts NOTHING, so the run would be a silent no-op. Refuse instead.
 *
 * Usage:
 *   npx tsx scripts/backfill-qualifications.ts              # dry run, all practitioners
 *   npx tsx scripts/backfill-qualifications.ts --slug sarah-schindler
 *   npx tsx scripts/backfill-qualifications.ts --apply
 */
import { PrismaClient } from '@prisma/client';
import { draftProfile, isLlmConfigured } from '../src/lib/onboarding-draft';

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
const SLUG = args.includes('--slug') ? args[args.indexOf('--slug') + 1] : null;

async function main() {
  if (!isLlmConfigured()) {
    console.error(
      'REFUSING: ONBOARDING_LLM_API_KEY is not set. draftProfile() would fall back to the\n' +
        'template path, which extracts no qualifications by design — the run would silently\n' +
        'write nothing and look like it worked.',
    );
    process.exit(1);
  }

  const catalog = (await prisma.specialty.findMany({ select: { slug: true, name: true } })).map(
    (s) => ({ slug: s.slug, name: s.name }),
  );

  const practitioners = await prisma.practitioner.findMany({
    where: {
      ...(SLUG ? { slug: SLUG } : {}),
      archivedAt: null,
    },
    select: {
      id: true,
      slug: true,
      displayName: true,
      headline: true,
      bio: true,
      whoIHelp: true,
      qualifications: true,
    },
    orderBy: { slug: 'asc' },
  });

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${practitioners.length} practitioner(s)\n`);

  for (const p of practitioners) {
    if (p.qualifications.length > 0 && !FORCE) {
      console.log(`· ${p.slug}: SKIP — already has ${p.qualifications.length} (use --force)`);
      continue;
    }

    // Their own words are the only source. No external lookup, nothing invented.
    const source = [p.headline, p.whoIHelp, p.bio].filter(Boolean).join('\n\n');
    if (source.trim().length < 40) {
      console.log(`· ${p.slug}: SKIP — too little profile text to extract from`);
      continue;
    }

    let qualifications: string[] = [];
    try {
      const { draft } = await draftProfile({
        displayName: p.displayName,
        rawSource: source,
        canonicalCatalog: catalog,
      });
      // ⚠️ ONLY this field is read. draft.headline/tagline/whoIHelp/bio/specialties/caseStudies
      // are deliberately DISCARDED — writing them is what makes the /edit action destructive.
      qualifications = draft.qualifications;
    } catch (err) {
      console.error(`· ${p.slug}: FAILED — ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    if (qualifications.length === 0) {
      // Correct and expected whenever the profile states no credentials. An empty result is the
      // extractive rule working, not a failure.
      console.log(`· ${p.slug}: none stated in their own copy — nothing to write`);
      continue;
    }

    console.log(`· ${p.slug}:`);
    for (const q of qualifications) console.log(`    - ${q}`);

    if (APPLY) {
      await prisma.practitioner.update({
        where: { id: p.id },
        data: { qualifications },
      });
      console.log('    ✓ written');
    }
  }

  if (!APPLY) console.log('\nDry run only. Re-run with --apply to write.');
  console.log(
    '\nNOTE: qualifications also feed searchText, which this script does NOT rebuild.\n' +
      'They will enter the index the next time the practitioner saves their profile, or when\n' +
      'a reindex runs. Display on the public profile is immediate either way.',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
