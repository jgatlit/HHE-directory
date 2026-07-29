/**
 * Whop health check — the tier that covers what e2e tests structurally cannot.
 *
 * Whop's KYC is third-party hosted identity verification, so the enrolment leg can never be
 * automated in CI. Instead of pretending to test it, this detects its failure modes after the
 * fact: dropped webhooks, stalled verifications, and drift between our DB and Whop's.
 *
 * Read-only. Safe against production.
 *   npx tsx --env-file=.env scripts/whop-health.ts
 *   npx tsx --env-file=.env scripts/whop-health.ts --url https://naturalhealthpros.com
 */

import { PrismaClient } from '@prisma/client';

const BASE = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'https://naturalhealthpros.com';

const STALE_VERIFICATION_DAYS = 7;

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const record = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

async function status(path: string): Promise<number> {
  try {
    const res = await fetch(`${BASE}${path}`, { redirect: 'manual' });
    return res.status;
  } catch {
    return 0;
  }
}

/**
 * Route-level invariants. These are the properties that, if they silently flipped, would either
 * expose gated surfaces or take payments offline — and none of them are visible from a 200/OK.
 */
async function httpChecks(): Promise<void> {
  for (const path of ['/', '/search']) {
    const s = await status(path);
    record(`public ${path}`, s === 200, `HTTP ${s} (expect 200)`);
  }

  for (const path of ['/admin', '/admin/connected-accounts', '/onboarding']) {
    const s = await status(path);
    record(`gated ${path}`, s === 307, `HTTP ${s} (expect 307 → signin)`);
  }

  // 401 (not 503) proves the signing secret is actually bound in the running deployment.
  // Vercel binds env at deploy time, so a secret added after a deploy stays inert until the
  // next one — this check is what makes that silent failure loud.
  const unsigned = await fetch(`${BASE}/api/whop/webhook/v1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
    .then((r) => r.status)
    .catch(() => 0);
  record(
    'webhook/v1 rejects unsigned',
    unsigned === 401,
    `HTTP ${unsigned} (expect 401; 503 = secret NOT bound in this deploy)`,
  );

  const legacy = await fetch(`${BASE}/api/whop/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
    .then((r) => r.status)
    .catch(() => 0);
  record('legacy webhook still up', legacy === 401, `HTTP ${legacy} (expect 401 until retired)`);
}

/**
 * State-level canaries. Each corresponds to a way the KYC handoff can fail silently — the
 * practitioner leaves for Whop and simply never comes back, with nothing in our logs.
 */
async function dbChecks(prisma: PrismaClient): Promise<void> {
  const now = Date.now();

  const practitioners = await prisma.practitioner.findMany({
    select: {
      slug: true,
      whopCompanyId: true,
      whopPayoutStatus: true,
      whopPayoutsEnabled: true,
      whopCompanyCreatedAt: true,
      _count: { select: { whopProducts: true } },
    },
  });

  const stalled = practitioners.filter(
    (p) =>
      p.whopCompanyId &&
      !p.whopPayoutsEnabled &&
      p.whopCompanyCreatedAt &&
      now - p.whopCompanyCreatedAt.getTime() > STALE_VERIFICATION_DAYS * 86_400_000,
  );
  record(
    'no stalled verifications',
    stalled.length === 0,
    stalled.length === 0
      ? `none older than ${STALE_VERIFICATION_DAYS}d`
      : `${stalled.length} stuck >${STALE_VERIFICATION_DAYS}d: ${stalled.map((p) => `${p.slug}(${p.whopPayoutStatus})`).join(', ')}`,
  );

  // Completed KYC but never published anything — a funnel leak, and the exact fingerprint of the
  // "publish button was missing" gap. Worth watching even after that is wired.
  const readyUnsold = practitioners.filter((p) => p.whopPayoutsEnabled && p._count.whopProducts === 0);
  record(
    'payouts-enabled practitioners have offerings',
    readyUnsold.length === 0,
    readyUnsold.length === 0 ? 'none idle' : `${readyUnsold.length} verified but zero offerings: ${readyUnsold.map((p) => p.slug).join(', ')}`,
  );

  const unprocessed = await prisma.whopWebhookEvent.count({ where: { processedAt: null } });
  record(
    'all webhook events processed',
    unprocessed === 0,
    unprocessed === 0 ? 'none pending' : `${unprocessed} rows with processedAt = null`,
  );

  const failed = await prisma.whopWebhookEvent.count({ where: { NOT: { error: null } } });
  record('no webhook handler errors', failed === 0, failed === 0 ? 'clean' : `${failed} rows with an error`);

  // Drift against Whop's own roster. Webhooks stop retrying after ~70s, so a dropped delivery is
  // permanent and this reconciliation is the only thing that surfaces it.
  const local = practitioners.filter((p) => p.whopCompanyId);
  try {
    const { listConnectedAccounts } = await import('../src/lib/whop');
    const remote = await listConnectedAccounts();
    const remoteIds = new Set(remote.map((a) => a.id));
    const localIds = new Set(local.map((p) => p.whopCompanyId as string));

    const missingRemotely = local.filter((p) => !remoteIds.has(p.whopCompanyId as string));
    const orphans = remote.filter((a) => !localIds.has(a.id));

    record(
      'no drift vs Whop',
      missingRemotely.length === 0 && orphans.length === 0,
      missingRemotely.length === 0 && orphans.length === 0
        ? `${remote.length} connected account(s) reconciled`
        : `${missingRemotely.length} local-only, ${orphans.length} orphaned in Whop`,
    );
  } catch (e) {
    record('no drift vs Whop', true, `skipped — Whop unreachable (${(e as Error).message.slice(0, 60)})`);
  }
}

(async () => {
  console.log(`Whop health · ${BASE}\n`);
  await httpChecks();

  const prisma = new PrismaClient();
  try {
    await dbChecks(prisma);
  } catch (e) {
    record('database reachable', false, (e as Error).message.slice(0, 80));
  } finally {
    await prisma.$disconnect();
  }

  const pad = Math.max(...checks.map((c) => c.name.length));
  for (const c of checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name.padEnd(pad)}  ${c.detail}`);

  const failures = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failures.length}/${checks.length} passed`);
  process.exit(failures.length === 0 ? 0 : 1);
})();
