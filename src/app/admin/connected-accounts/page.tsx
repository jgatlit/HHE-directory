import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, AlertTriangle, Check, Clock, X, MinusCircle, AlertCircle } from 'lucide-react';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { listConnectedAccounts, WhopNotConfigured, type WhopPayoutStatus } from '@/lib/whop';
import { isProfileComplete } from '@/lib/practitioner-indexer';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

type ConnectedAccount = Awaited<ReturnType<typeof listConnectedAccounts>>[number];

type WhopFetchResult =
  | { ok: true; accounts: ConnectedAccount[] }
  | { ok: false; reason: string };

// Statuses that need an operator or the practitioner to do something, or that represent an
// active negative outcome — distinct from "in progress" (pending_verification) or "never
// started" (not_started).
const NEEDS_ACTION_STATUSES = new Set<string>([
  'action_required',
  'manual_review',
  'disabled',
  'verification_failed',
  'denied',
  'blocked_by_parent',
]);

const PAYOUT_STATUS_LABEL: Record<WhopPayoutStatus, string> = {
  not_started: 'Not started',
  pending_verification: 'Pending verification',
  action_required: 'Action required',
  manual_review: 'Manual review',
  connected: 'Connected',
  disabled: 'Disabled',
  verification_failed: 'Verification failed',
  denied: 'Denied',
  blocked_by_parent: 'Blocked by parent',
};

export default async function ConnectedAccountsPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    redirect('/auth/signin?callbackUrl=/admin/connected-accounts');
  }

  const practitioners = await prisma.practitioner.findMany({
    include: {
      user: { select: { email: true } },
      whopProducts: { where: { archived: false } },
      specialties: { select: { specialtyId: true } },
    },
    orderBy: [{ displayName: 'asc' }],
  });

  // Surface the cases that need eyes first: restricted accounts, then anything needing action,
  // then in-progress, then fully connected, then never-started — displayName as tiebreak.
  practitioners.sort((a, b) => statusPriority(a) - statusPriority(b) || a.displayName.localeCompare(b.displayName));

  const totals = {
    total: practitioners.length,
    payoutsEnabled: practitioners.filter((p) => p.whopPayoutsEnabled).length,
    restricted: practitioners.filter((p) => p.whopPayoutStatus === 'connected' && !p.whopPayoutsEnabled).length,
    needsAction: practitioners.filter((p) => NEEDS_ACTION_STATUSES.has(p.whopPayoutStatus)).length,
    notStarted: practitioners.filter((p) => p.whopPayoutStatus === 'not_started').length,
  };

  const whopResult = await fetchWhopAccounts();
  const drift = whopResult.ok ? computeDrift(whopResult.accounts, practitioners) : null;

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-10 sm:py-14">
      <div className="mx-auto max-w-3xl space-y-6">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to admin tools
        </Link>

        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Connected accounts (Whop)</h1>
          <p className="text-sm text-muted-foreground">
            Practitioner payout status on Whop, plus live reconciliation against Whop&apos;s connected accounts.
          </p>
        </header>

        <SummaryStrip totals={totals} />

        <Card className="overflow-hidden">
          <div className="border-b bg-muted/40 px-5 py-3">
            <h2 className="text-sm font-semibold">
              All practitioners{' '}
              <span className="text-muted-foreground">({practitioners.length})</span>
            </h2>
          </div>
          {practitioners.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              No practitioners yet.
            </p>
          ) : (
            <ul className="divide-y">
              {practitioners.map((p) => {
                const complete = isProfileComplete(p);
                return (
                  <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/practitioners/${p.slug}`}
                        className="truncate text-sm font-medium underline-offset-2 hover:underline"
                      >
                        {p.displayName || <span className="italic text-muted-foreground">(no name)</span>}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {p.user.email}
                        {p.whopCompanyId && ` · ${p.whopCompanyId}`}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-1.5 text-xs text-muted-foreground">
                      {!complete && (
                        <Badge
                          variant="outline"
                          className="gap-1 border-amber-500/40 bg-amber-500/10 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400"
                        >
                          <AlertCircle className="h-3 w-3" />
                          Profile incomplete
                        </Badge>
                      )}
                      {p.whopProducts.length > 0 && (
                        <span className="tabular-nums">
                          {p.whopProducts.length} offering
                          {p.whopProducts.length === 1 ? '' : 's'}
                        </span>
                      )}
                      <PayoutStatusBadge status={p.whopPayoutStatus} />
                      <PayoutsEnabledBadge enabled={p.whopPayoutsEnabled} status={p.whopPayoutStatus} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <ReconciliationSection result={whopResult} drift={drift} />

        <p className="text-center text-xs text-muted-foreground">
          Payout status (<code className="rounded bg-muted px-1 py-0.5">whopPayoutStatus</code>) and the
          public-checkout gate (<code className="rounded bg-muted px-1 py-0.5">whopPayoutsEnabled</code>) are
          set by Whop&apos;s <code className="rounded bg-muted px-1 py-0.5">identity_profile.*</code> webhooks.
          See{' '}
          <code className="rounded bg-muted px-1 py-0.5">docs/PHASE-2C-WHOP-CONNECTED-ACCOUNTS.md</code>{' '}
          for the lifecycle.
        </p>
      </div>
    </main>
  );
}

function statusPriority(p: { whopPayoutStatus: string; whopPayoutsEnabled: boolean }): number {
  if (p.whopPayoutStatus === 'connected' && !p.whopPayoutsEnabled) return 0;
  if (NEEDS_ACTION_STATUSES.has(p.whopPayoutStatus)) return 1;
  if (p.whopPayoutStatus === 'pending_verification') return 2;
  if (p.whopPayoutStatus === 'connected' && p.whopPayoutsEnabled) return 3;
  return 4; // not_started, or an unrecognized status drifted in from Whop
}

/** Never let Whop connectivity — missing config or a live API error — break this page. */
async function fetchWhopAccounts(): Promise<WhopFetchResult> {
  try {
    const accounts = await listConnectedAccounts();
    return { ok: true, accounts };
  } catch (e) {
    if (e instanceof WhopNotConfigured) {
      return { ok: false, reason: 'Whop is not configured in this environment (missing API credentials).' };
    }
    return { ok: false, reason: e instanceof Error ? e.message : 'Unknown error contacting Whop.' };
  }
}

type DriftResult = ReturnType<typeof computeDrift>;

/**
 * Join Whop's live connected-account list against local rows. Drift here is expected, not a
 * bug — Whop retries a webhook for only ~70s before dropping it permanently, so a missed event
 * is the normal failure mode, and this reconciliation is what catches it.
 */
function computeDrift(
  accounts: ConnectedAccount[],
  practitioners: Array<{ id: string; displayName: string; whopCompanyId: string | null }>,
) {
  const localById = new Map(practitioners.map((p) => [p.id, p]));
  const whopIds = new Set(accounts.map((a) => a.id));

  const orphansInWhop = accounts.filter((a) => {
    const metaPractitionerId = typeof a.metadata?.practitioner_id === 'string' ? a.metadata.practitioner_id : null;
    const local = metaPractitionerId ? localById.get(metaPractitionerId) : undefined;
    return !local || local.whopCompanyId !== a.id;
  });

  const missingFromWhop = practitioners.filter((p) => p.whopCompanyId && !whopIds.has(p.whopCompanyId));

  return { orphansInWhop, missingFromWhop };
}

function SummaryStrip({
  totals,
}: {
  totals: {
    total: number;
    payoutsEnabled: number;
    restricted: number;
    needsAction: number;
    notStarted: number;
  };
}) {
  const cells: Array<{ label: string; value: number; warn?: boolean }> = [
    { label: 'Total', value: totals.total },
    { label: 'Payouts enabled', value: totals.payoutsEnabled },
    { label: 'Connected · restricted', value: totals.restricted, warn: true },
    { label: 'Needs action', value: totals.needsAction, warn: true },
    { label: 'Not started', value: totals.notStarted },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {cells.map((c) => (
        <Card key={c.label} className="px-3 py-2.5 text-center">
          <p
            className={
              c.warn && c.value > 0
                ? 'text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400'
                : 'text-2xl font-semibold tabular-nums'
            }
          >
            {c.value}
          </p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {c.label}
          </p>
        </Card>
      ))}
    </div>
  );
}

function PayoutStatusBadge({ status: rawStatus }: { status: string }) {
  const status = rawStatus as WhopPayoutStatus;
  switch (status) {
    case 'connected':
      return (
        <Badge variant="default" className="gap-1 text-[10px] uppercase tracking-wider">
          <Check className="h-3 w-3" />
          Connected
        </Badge>
      );
    case 'pending_verification':
      return (
        <Badge variant="secondary" className="gap-1 text-[10px] uppercase tracking-wider">
          <Clock className="h-3 w-3" />
          Pending verification
        </Badge>
      );
    case 'action_required':
    case 'manual_review':
      return (
        <Badge
          variant="outline"
          className="gap-1 border-amber-500/40 bg-amber-500/10 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400"
        >
          <AlertCircle className="h-3 w-3" />
          {PAYOUT_STATUS_LABEL[status]}
        </Badge>
      );
    case 'disabled':
    case 'verification_failed':
    case 'denied':
    case 'blocked_by_parent':
      return (
        <Badge variant="destructive" className="gap-1 text-[10px] uppercase tracking-wider">
          <X className="h-3 w-3" />
          {PAYOUT_STATUS_LABEL[status]}
        </Badge>
      );
    case 'not_started':
    default:
      return (
        <Badge variant="outline" className="gap-1 text-[10px] uppercase tracking-wider">
          <MinusCircle className="h-3 w-3" />
          {rawStatus in PAYOUT_STATUS_LABEL ? PAYOUT_STATUS_LABEL[status] : rawStatus}
        </Badge>
      );
  }
}

/**
 * whopPayoutsEnabled is the actual gate for public checkout, shown on every row rather than
 * folded into the status badge. A `connected` status paired with payouts disabled is an active
 * account restriction — materially different from "hasn't started yet" — so that combination
 * gets the same amber treatment as an in-progress status, not a quiet gray one.
 */
function PayoutsEnabledBadge({ enabled, status }: { enabled: boolean; status: string }) {
  if (enabled) {
    return (
      <Badge variant="default" className="gap-1 text-[10px] uppercase tracking-wider">
        <Check className="h-3 w-3" />
        Payouts enabled
      </Badge>
    );
  }
  const restricted = status === 'connected';
  return (
    <Badge
      variant="outline"
      className={
        restricted
          ? 'gap-1 border-amber-500/40 bg-amber-500/10 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400'
          : 'gap-1 text-[10px] uppercase tracking-wider'
      }
    >
      {restricted ? <AlertCircle className="h-3 w-3" /> : <MinusCircle className="h-3 w-3" />}
      {restricted ? 'Payouts restricted' : 'Payouts disabled'}
    </Badge>
  );
}

function ReconciliationSection({ result, drift }: { result: WhopFetchResult; drift: DriftResult | null }) {
  if (!result.ok) {
    return (
      <Card className="overflow-hidden">
        <div className="border-b bg-muted/40 px-5 py-3">
          <h2 className="text-sm font-semibold">Reconciliation against Whop</h2>
        </div>
        <div className="flex items-start gap-2 px-5 py-4 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Live reconciliation is unavailable right now: {result.reason} The table above still reflects
            what is stored locally.
          </p>
        </div>
      </Card>
    );
  }

  const { orphansInWhop, missingFromWhop } = drift!;
  const inSync = orphansInWhop.length === 0 && missingFromWhop.length === 0;

  return (
    <Card className="overflow-hidden">
      <div className="border-b bg-muted/40 px-5 py-3">
        <h2 className="text-sm font-semibold">
          Reconciliation against Whop
          {!inSync && (
            <span className="text-muted-foreground">
              {' '}
              ({orphansInWhop.length + missingFromWhop.length} to review)
            </span>
          )}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Webhooks retry for only ~70s before Whop drops them — drift here is expected, not a bug.
        </p>
      </div>
      {inSync ? (
        <p className="flex items-center gap-2 px-5 py-6 text-sm text-muted-foreground">
          <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          In sync — every local <code className="rounded bg-muted px-1 py-0.5">whopCompanyId</code> matches a
          Whop connected account, and vice versa.
        </p>
      ) : (
        <div className="divide-y">
          {orphansInWhop.length > 0 && (
            <div className="px-5 py-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                Orphans in Whop ({orphansInWhop.length})
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Connected accounts Whop returned that no local practitioner claims.
              </p>
              <ul className="mt-2 space-y-1.5">
                {orphansInWhop.map((a) => (
                  <li key={a.id} className="text-xs">
                    <span className="font-medium">{a.title}</span>{' '}
                    <span className="text-muted-foreground">
                      ({a.id}) · practitioner_id in metadata:{' '}
                      {typeof a.metadata?.practitioner_id === 'string' ? a.metadata.practitioner_id : 'none'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {missingFromWhop.length > 0 && (
            <div className="px-5 py-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                Missing from Whop ({missingFromWhop.length})
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Local practitioners with a <code className="rounded bg-muted px-1 py-0.5">whopCompanyId</code>{' '}
                that Whop did not return.
              </p>
              <ul className="mt-2 space-y-1.5">
                {missingFromWhop.map((p) => (
                  <li key={p.id} className="text-xs">
                    <span className="font-medium">{p.displayName || '(no name)'}</span>{' '}
                    <span className="text-muted-foreground">({p.whopCompanyId})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
