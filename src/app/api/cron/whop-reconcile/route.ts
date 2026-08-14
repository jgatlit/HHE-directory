import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getIdentityProfile, getPayoutStatus, isWhopPlatformsReady } from '@/lib/whop';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Drift sweep for Whop payout state — the safety net behind the identity_profile.* webhook.
 *
 * WHY THIS EXISTS. Whop retries a webhook 3x over ~70s and then drops it permanently. Until
 * 2026-08-13 the documented reconciliation for that was getPayoutStatus(companyId), which
 * queried `GET /payout_accounts/{biz_…}` — an id type that endpoint does not accept, so it
 * 404'd on every call and the 404 branch swallowed it as "normal pre-KYC state". The net had a
 * hole the exact size of itself. Sarah Schindler was approved by Whop on 2026-08-11 and sat at
 * `not_started` for two days with nothing anywhere reporting a problem.
 *
 * WHAT IT READS. `GET /identity_profiles/{idpf_…}` is the only endpoint exposing all three
 * payout-gating fields together: `status`, `payout_status`, `payouts_enabled`. Keyed on
 * `status: 'approved'` — there is no usable "verified" signal, since the company object's
 * `verified` boolean reads false for every company we own including the platform company.
 *
 * Auth: same shape as /api/cron/trial-sweep — Bearer CRON_SECRET when set, open when unset.
 */

/** Whop ids are only learnable from webhooks, so a null id means "never had a delivery". */
type Drift = {
  slug: string;
  field: string;
  was: string;
  now: string;
};

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isWhopPlatformsReady()) {
    return NextResponse.json({ error: 'whop not configured' }, { status: 503 });
  }

  const practitioners = await prisma.practitioner.findMany({
    where: { whopCompanyId: { not: null } },
    select: {
      id: true,
      slug: true,
      whopIdentityProfileId: true,
      whopPayoutAccountId: true,
      whopPayoutStatus: true,
      whopPayoutsEnabled: true,
    },
  });

  const drift: Drift[] = [];
  const unpollable: string[] = [];
  const errors: string[] = [];

  for (const p of practitioners) {
    // No stored ids means no webhook ever resolved for this practitioner. That is itself the
    // alarm — it is the exact signature of the bug this sweep was written to catch — so it is
    // reported rather than skipped silently.
    if (!p.whopIdentityProfileId && !p.whopPayoutAccountId) {
      unpollable.push(p.slug);
      continue;
    }

    try {
      const update: Record<string, unknown> = {};
      // Staged, not published. Nothing enters `drift` until the row is actually written —
      // otherwise a failed update still reports `corrected: N` and logs "corrected drift" for
      // changes that were rolled back.
      const pending: Drift[] = [];
      let observedStatus: string | null = null;

      const profile = p.whopIdentityProfileId
        ? await getIdentityProfile(p.whopIdentityProfileId)
        : null;

      if (profile) {
        observedStatus = profile.payoutStatus ?? null;

        // ONE-WAY ONLY: this sweep may OPEN the payout gate, never close it.
        //
        // Gate on `status`/`payout_status`, NOT on `payouts_enabled`. A parent-company API key
        // under-reports the boolean: Whop's own identity_profile.updated for idpf_f9VEKuIiqGPc2
        // carried `payouts_enabled: true` with `linked_companies` populated, and GET
        // /identity_profiles returns `false` with `linked_companies: []` for that same profile
        // today. The boolean is authoritative on the WEBHOOK and unreliable on READ, so gating
        // the sweep on it means the sweep can never open the gate it exists to open.
        //
        // Revocation stays exclusively with identity_profile.rejected / needs_action — a `false`
        // here is "unconfirmed", never "revoked", and acting on it would let a read artifact
        // silently delist a practitioner who can actually take payments.
        if (
          profile.status === 'approved' &&
          profile.payoutStatus === 'connected' &&
          !p.whopPayoutsEnabled
        ) {
          pending.push({ slug: p.slug, field: 'whopPayoutsEnabled', was: 'false', now: 'true' });
          update.whopPayoutsEnabled = true;
        }
      } else if (p.whopPayoutAccountId) {
        // Reached when there is no identity-profile id OR the profile did not resolve (404 on a
        // stale idpf_). A practitioner holding both ids must still fall through to here — an
        // `else if` on the id alone would strand them with no fallback and no error.
        const { status } = await getPayoutStatus(p.whopPayoutAccountId);
        observedStatus = status ?? null;
      } else {
        // Neither id resolved to anything. Report it rather than counting a silent no-op as a
        // verified row.
        errors.push(`${p.slug}: no Whop resource resolved (identity profile 404 or missing)`);
      }

      if (observedStatus && observedStatus !== p.whopPayoutStatus) {
        pending.push({
          slug: p.slug,
          field: 'whopPayoutStatus',
          was: p.whopPayoutStatus,
          now: observedStatus,
        });
        update.whopPayoutStatus = observedStatus;
      }

      if (Object.keys(update).length > 0) {
        await prisma.practitioner.update({ where: { id: p.id }, data: update });
        drift.push(...pending);
      }
    } catch (e) {
      errors.push(`${p.slug}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (unpollable.length > 0) {
    console.error(
      `whop-reconcile: ${unpollable.length} connected account(s) have NO Whop resource ids — ` +
        `no webhook has ever resolved for them: ${unpollable.join(', ')}`,
    );
  }
  if (drift.length > 0) {
    console.warn('whop-reconcile: corrected drift:', JSON.stringify(drift));
  }

  // 207 on any failure, matching /api/cron/trial-sweep. A sweep that polled twelve accounts,
  // failed all twelve on a rotated key, and returned 200 is indistinguishable from a clean run
  // to Vercel cron monitoring — the silent-success shape this route exists to eliminate.
  const ok = errors.length === 0 && unpollable.length === 0;
  return NextResponse.json(
    { ok, checked: practitioners.length, corrected: drift.length, drift, unpollable, errors },
    { status: ok ? 200 : 207 },
  );
}
