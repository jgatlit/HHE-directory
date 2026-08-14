/**
 * DRY RUN BY DEFAULT; --apply is the only thing that writes.
 *
 *   npx tsx --env-file=.env scripts/backfill-whop-resource-ids.ts            # report only
 *   npx tsx --env-file=.env scripts/backfill-whop-resource-ids.ts --apply    # write
 *
 * WHAT THIS IS FOR
 * `whopIdentityProfileId` / `whopPayoutAccountId` are written in exactly one place —
 * `idCapture()` in the v1 webhook — and that only runs on events received AFTER it shipped.
 * Practitioners whose KYC completed before then have the ids sitting in `WhopWebhookEvent.payload`
 * and nowhere else, so `/api/cron/whop-reconcile` reports them `unpollable` forever.
 *
 * WHY IT IS SAFE
 * Every id written here comes from a webhook WE RECEIVED AND STORED, attributed by the same
 * envelope `company_id` → `whopCompanyId` mapping the live handler uses. Nothing is inferred from
 * names, addresses, or ordering, and nothing is fetched from Whop. It is a replay of our own
 * records, not a reconstruction.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * It never writes `whopPayoutsEnabled`. Opening the payout gate is `/api/cron/whop-reconcile`'s
 * job, from a LIVE read of `status` + `payout_status`. Backfilling the ids is what makes a
 * practitioner pollable; the sweep then decides. Keeping the money gate out of a one-off script
 * means the decision always comes from current state, never from a replayed 2026-08-11 snapshot.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

type Extracted = { identityProfileId?: string; payoutAccountId?: string; from: string[] };

async function main() {
  const practitioners = await prisma.practitioner.findMany({
    where: { whopCompanyId: { not: null } },
    select: {
      id: true,
      slug: true,
      whopCompanyId: true,
      whopIdentityProfileId: true,
      whopPayoutAccountId: true,
      whopPayoutStatus: true,
      whopPayoutsEnabled: true,
    },
  });

  const events = await prisma.whopWebhookEvent.findMany({ select: { eventType: true, payload: true } });
  console.log('practitioners with a connected account: %d | stored webhook events: %d\n',
    practitioners.length, events.length);

  const byCompany = new Map<string, Extracted>();
  for (const e of events) {
    const p = e.payload as Record<string, unknown> | null;
    if (!p) continue;
    const companyId = typeof p.company_id === 'string' ? p.company_id : null;
    const data = (p.data ?? null) as Record<string, unknown> | null;
    const id = data && typeof data.id === 'string' ? data.id : null;
    if (!companyId || !id) continue;

    const acc = byCompany.get(companyId) ?? { from: [] };
    if (id.startsWith('idpf_')) acc.identityProfileId = id;
    if (id.startsWith('poact_')) acc.payoutAccountId = id;
    if (id.startsWith('idpf_') || id.startsWith('poact_')) acc.from.push(`${e.eventType}→${id}`);
    byCompany.set(companyId, acc);
  }

  let planned = 0;
  for (const p of practitioners) {
    const found = byCompany.get(p.whopCompanyId!) ?? { from: [] };
    const update: Record<string, string> = {};
    if (!p.whopIdentityProfileId && found.identityProfileId) {
      update.whopIdentityProfileId = found.identityProfileId;
    }
    if (!p.whopPayoutAccountId && found.payoutAccountId) {
      update.whopPayoutAccountId = found.payoutAccountId;
    }

    console.log('%s (%s)', p.slug, p.whopCompanyId);
    console.log('   current: idpf=%s poact=%s payoutStatus=%s payoutsEnabled=%s',
      p.whopIdentityProfileId ?? '—', p.whopPayoutAccountId ?? '—',
      p.whopPayoutStatus, p.whopPayoutsEnabled);
    console.log('   evidence: %s', found.from.length ? found.from.join(', ') : 'none in stored events');

    if (Object.keys(update).length === 0) {
      console.log('   → nothing to backfill\n');
      continue;
    }
    planned += 1;
    console.log('   → WOULD SET %s', JSON.stringify(update));
    if (APPLY) {
      await prisma.practitioner.update({ where: { id: p.id }, data: update });
      console.log('   ✓ applied');
    }
    console.log('');
  }

  console.log(APPLY ? `APPLIED to ${planned} practitioner(s).` : `DRY RUN — ${planned} practitioner(s) would change. Re-run with --apply.`);
  if (planned > 0) {
    console.log('\nNext: /api/cron/whop-reconcile (hourly at :20) reads LIVE status and opens the');
    console.log('payout gate where Whop reports approved + connected. This script never does that.');
    console.log('To check immediately:  curl -s https://naturalhealthpros.com/api/cron/whop-reconcile');
  }
}

main().finally(() => prisma.$disconnect());
