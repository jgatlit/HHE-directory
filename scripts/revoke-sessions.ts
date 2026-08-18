import { prisma } from '../src/lib/prisma';

/**
 * Sign a user out EVERYWHERE, immediately.
 *
 * Sessions use the JWT strategy and no longer expire, so there are no `Session` rows to delete —
 * bumping `User.sessionVersion` is the only thing that kills an issued token. Every JWT carries
 * the version it was minted with; the `jwt` callback rejects any that no longer matches.
 *
 * Use for: a suspected stolen token, a lost or stolen device, an offboarding where you want the
 * person out NOW rather than merely demoted.
 *
 * ⚠️ Do NOT use this to take away admin. Role is re-read from the database on every request, so
 * demoting someone takes effect on their next request without touching their session — and a
 * demoted admin is usually still a practitioner who should keep working, not be thrown out
 * mid-edit. This is the blunt instrument; reach for it only when the SESSION is the problem.
 *
 *   npx tsx --env-file=.env scripts/revoke-sessions.ts someone@example.com          # dry run
 *   npx tsx --env-file=.env scripts/revoke-sessions.ts someone@example.com --apply
 */
async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const email = args.find((a) => !a.startsWith('--'))?.trim().toLowerCase();

  if (!email) {
    console.error('Usage: revoke-sessions.ts <email> [--apply]');
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, role: true, sessionVersion: true },
  });

  if (!user) {
    // Loud, not silent: a typo must not read as "revoked, nothing to do".
    console.error(`NO SUCH USER: ${email} — nothing was revoked. Check the address.`);
    process.exitCode = 1;
    return;
  }

  console.log(`user            ${user.email}  (${user.role})`);
  console.log(`sessionVersion  ${user.sessionVersion} -> ${user.sessionVersion + 1}`);

  if (!apply) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to sign this user out everywhere.');
    return;
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  });

  console.log(`\n✅ Revoked. Every token issued before now is dead; sessionVersion is ${updated.sessionVersion}.`);
  console.log('   They can sign in again immediately via magic link — this kills sessions, not accounts.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
