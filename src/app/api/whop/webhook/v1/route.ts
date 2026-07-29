import { NextResponse, type NextRequest } from 'next/server';
import type { Practitioner, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { unwrapWebhook } from '@/lib/whop';
import { indexPractitioner } from '@/lib/practitioner-indexer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Whop API v1 webhook receiver (Standard Webhooks spec) — runs alongside the legacy handler at
// src/app/api/whop/webhook/route.ts, which stays on the old {action,data} shape and drives live
// revenue today. This route owns Connected Accounts (Layer Y) payout-readiness events.

type V1Event = { type: string; data: Record<string, unknown> };

function isV1Event(x: unknown): x is V1Event {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as { type?: unknown }).type === 'string' &&
    typeof (x as { data?: unknown }).data === 'object' &&
    (x as { data?: unknown }).data !== null
  );
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined;
}

/**
 * First match wins: explicit practitioner_id metadata (set at checkout/account-link mint time),
 * then any company id the payload carries. Never throws — a resolution failure just means the
 * event is recorded without a practitioner attached.
 */
async function resolvePractitioner(data: Record<string, unknown>): Promise<Practitioner | null> {
  try {
    const metadata = asRecord(data.metadata);
    const practitionerId = asString(metadata?.practitioner_id);
    if (practitionerId) {
      const byId = await prisma.practitioner.findUnique({ where: { id: practitionerId } });
      if (byId) return byId;
    }

    // `account_id` carries a biz_ tag on payout/identity resources (the same tag /verifications
    // is queried by). It matters because `linked_companies` is documented as empty whenever the
    // caller is an API key rather than a user session — so on identity_profile.* events, which
    // are the ones that gate payouts, it may be the ONLY company reference in the payload.
    const linkedCompanies = Array.isArray(data.linked_companies) ? data.linked_companies : undefined;
    const companyId =
      asString(asRecord(data.company)?.id) ??
      asString(data.company_id) ??
      asString(data.account_id) ??
      asString(asRecord(data.payout_account)?.company_id) ??
      asString(asRecord(linkedCompanies?.[0])?.id);
    if (companyId) {
      const byCompany = await prisma.practitioner.findUnique({ where: { whopCompanyId: companyId } });
      if (byCompany) return byCompany;
    }

    return null;
  } catch (e) {
    console.error('v1 webhook: practitioner resolution failed:', e);
    return null;
  }
}

/** Apply a payout-readiness change and re-run the listing gate (Typesense is push-based). */
async function updatePayoutState(practitionerId: string, data: Prisma.PractitionerUpdateInput): Promise<void> {
  await prisma.practitioner.update({ where: { id: practitionerId }, data });
  await indexPractitioner(practitionerId).catch((e) =>
    console.error('v1 webhook: reindex after payout-state change failed:', e),
  );
}

async function handleEvent(type: string, data: Record<string, unknown>): Promise<void> {
  switch (type) {
    case 'identity_profile.approved': {
      const practitioner = await resolvePractitioner(data);
      if (!practitioner) return;
      await updatePayoutState(practitioner.id, {
        whopPayoutsEnabled: true,
        whopPayoutStatus: 'connected',
        whopKycCompletedAt: new Date(),
        whopKycStatus: 'VERIFIED', // legacy mirror, kept one release for expand/contract
      });
      return;
    }
    case 'identity_profile.rejected': {
      const practitioner = await resolvePractitioner(data);
      if (!practitioner) return;
      await updatePayoutState(practitioner.id, {
        whopPayoutsEnabled: false,
        whopPayoutStatus: 'verification_failed',
        whopKycStatus: 'REJECTED',
      });
      return;
    }
    case 'identity_profile.needs_action': {
      const practitioner = await resolvePractitioner(data);
      if (!practitioner) return;
      await updatePayoutState(practitioner.id, {
        whopPayoutsEnabled: false,
        whopPayoutStatus: 'action_required',
        whopKycStatus: 'PENDING',
      });
      return;
    }
    case 'identity_profile.updated': {
      const practitioner = await resolvePractitioner(data);
      if (!practitioner) return;
      const update: Prisma.PractitionerUpdateInput = {};
      if (typeof data.payouts_enabled === 'boolean') update.whopPayoutsEnabled = data.payouts_enabled;
      const payoutStatus = asString(data.payout_status);
      if (payoutStatus) update.whopPayoutStatus = payoutStatus;
      if (Object.keys(update).length === 0) return;
      await updatePayoutState(practitioner.id, update);
      return;
    }
    case 'payout_account.status_updated': {
      const practitioner = await resolvePractitioner(data);
      if (!practitioner) return;
      const update: Prisma.PractitionerUpdateInput = {};
      const status = asString(data.status);
      if (status) update.whopPayoutStatus = status;
      if (typeof data.payouts_enabled === 'boolean') update.whopPayoutsEnabled = data.payouts_enabled;
      if (Object.keys(update).length === 0) return;
      await updatePayoutState(practitioner.id, update);
      return;
    }
    case 'payment.succeeded':
      // Recorded in the audit row above; there is no financial state to mutate yet and
      // WhopWebhookEvent has no practitioner relation, so resolving here would only burn a query
      // on the highest-volume event. Attribution is available from the payload's metadata when
      // Layer Y reporting needs it.
      return;
    default:
      return;
  }
}

export async function POST(request: NextRequest) {
  // Fail CLOSED until a v1 signing secret exists. Either registration's secret is sufficient:
  // the platform needs TWO webhooks (child_resource_events is exclusive, not additive), each
  // with its own secret, and both post here.
  if (!process.env.WHOP_V1_WEBHOOK_SECRET && !process.env.WHOP_V1_WEBHOOK_SECRET_CHILD) {
    return NextResponse.json({ error: 'webhook not configured' }, { status: 503 });
  }

  const rawBody = await request.text();
  const headers = Object.fromEntries(request.headers);

  let event: unknown;
  try {
    event = unwrapWebhook(rawBody, headers);
  } catch {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  if (!isV1Event(event)) {
    return NextResponse.json({ ok: true });
  }
  const { type, data } = event;

  // Standard Webhooks dedup key. Composite fallback only covers the (unexpected) case where the
  // header is missing — the header is what makes redelivery-safe upserts actually redelivery-safe.
  const whopEventId = headers['webhook-id'] ?? `${type}:${asString(data.id) ?? 'unknown'}`;

  const logged = await prisma.whopWebhookEvent
    .upsert({
      where: { whopEventId },
      update: { eventType: type, payload: event as Prisma.InputJsonValue },
      create: { whopEventId, eventType: type, payload: event as Prisma.InputJsonValue },
    })
    .catch((e) => {
      console.error('v1 webhook: audit-row upsert failed:', e);
      return null;
    });

  // Whop retries only 3x (10s/20s/40s) then drops the event for good — a DB hiccup must never
  // turn into a non-2xx, or a legitimate event is lost permanently rather than just delayed.
  try {
    await handleEvent(type, data);
  } catch (e) {
    console.error('v1 webhook: handler failed (acking anyway):', e);
  }

  if (logged) {
    await prisma.whopWebhookEvent
      .update({ where: { id: logged.id }, data: { processedAt: new Date() } })
      .catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
