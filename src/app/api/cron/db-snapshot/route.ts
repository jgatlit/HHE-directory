import { NextResponse } from 'next/server';
import { checkDbHealth } from '@/lib/db-health';
import { sendEmail } from '@/lib/email';
import { createSnapshot, deleteSnapshot, listSnapshots } from '@/lib/neon-snapshots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * WEEKLY DATABASE SNAPSHOT, gated on the database being healthy first.
 *
 * Order is the whole design, and it is deliberately NOT "create then delete":
 *
 *   1. VALIDATE the live database is healthy, current and lossless.
 *   2. If it is NOT — STOP. Email the admin. Touch NOTHING.
 *   3. Only then: delete the previous snapshot, create a new one.
 *
 * Why validate first. Neon's Free plan allows exactly ONE manual snapshot, so rotation must delete
 * before it creates, and there is a window with no snapshot at all. Running that blind against a
 * damaged database would delete the only good copy and replace it with a snapshot OF THE DAMAGE.
 *
 * That is not theoretical. On 2026-08-27 a `prisma migrate diff --shadow-database-url` aimed at
 * production dropped every table; the site 500'd for ~3 hours and was recovered only because a
 * pre-incident copy still existed. A blind rotation during that window would have made the loss
 * permanent. The gate exists for exactly that hour.
 *
 * ⚠️ FAILING TO SNAPSHOT IS SAFE. FAILING TO NOTICE IS NOT. Every abort path emails the admin, and
 * the route returns a NON-200 so Vercel's cron log shows it red. Silence must never be the way
 * this reports a problem — the 6-hour PITR window is the only other net, and it is short.
 *
 * Auth: same shape as the sibling crons — requires `Authorization: Bearer <CRON_SECRET>` when
 * CRON_SECRET is set (Vercel Cron sends it automatically); open when unset, for local curling.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.NEON_API_KEY;
  const projectId = process.env.NEON_PROJECT_ID ?? process.env.hhe_directory_NEON_PROJECT_ID;
  const branchId = process.env.NEON_BRANCH_ID;

  // Refuse loudly rather than reporting success while doing nothing. An unconfigured backup job
  // that returns 200 is worse than no backup job: it manufactures false confidence.
  const missing = [
    !apiKey && 'NEON_API_KEY',
    !projectId && 'NEON_PROJECT_ID',
    !branchId && 'NEON_BRANCH_ID',
  ].filter(Boolean);
  if (missing.length) {
    const msg = `db-snapshot cron is UNCONFIGURED — missing ${missing.join(', ')}. No snapshot was taken.`;
    console.error(`[db-snapshot] ${msg}`);
    await notifyAdmin('NHP: weekly DB snapshot is not configured', msg).catch(() => {});
    return NextResponse.json({ ok: false, reason: 'unconfigured', missing }, { status: 500 });
  }

  // ── 1. VALIDATE ───────────────────────────────────────────────────────────────────────────
  const health = await checkDbHealth();

  if (!health.healthy) {
    // STOP. Do not delete, do not create. The existing snapshot may be the only good copy left.
    const body = [
      'The weekly database snapshot was SKIPPED because the live database failed its health check.',
      '',
      'THE PREVIOUS SNAPSHOT HAS NOT BEEN DELETED. If the database is damaged, that snapshot and',
      "Neon's point-in-time history are the recovery path — do not run anything destructive.",
      '',
      'Failures:',
      ...health.failures.map((f) => `  - ${f}`),
      '',
      `Row counts: ${JSON.stringify(health.counts)}`,
      ...(health.warnings.length ? ['', 'Warnings:', ...health.warnings.map((w) => `  - ${w}`)] : []),
    ].join('\n');

    console.error('[db-snapshot] ABORTED — database unhealthy', health.failures);
    await notifyAdmin('🚨 NHP: DB snapshot SKIPPED — database looks damaged', body).catch((e) =>
      console.error('[db-snapshot] admin email failed', e),
    );
    return NextResponse.json({ ok: false, reason: 'unhealthy', health }, { status: 500 });
  }

  // ── 2. ROTATE ─────────────────────────────────────────────────────────────────────────────
  try {
    const existing = await listSnapshots(apiKey!, projectId!, branchId!);

    // Delete BEFORE creating, because the Free plan holds only one. Ordering is forced, which is
    // why step 1 is not optional.
    for (const s of existing) {
      await deleteSnapshot(apiKey!, projectId!, s.id);
      console.warn(`[db-snapshot] deleted previous snapshot ${s.id}`);
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const created = await createSnapshot(apiKey!, projectId!, branchId!, `weekly-${stamp}`);

    console.warn(`[db-snapshot] created ${created.id}`, health.counts);

    if (health.warnings.length) {
      await notifyAdmin(
        'NHP: weekly DB snapshot taken, with warnings',
        ['Snapshot succeeded, but:', ...health.warnings.map((w) => `  - ${w}`)].join('\n'),
      ).catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      created: created.id,
      deleted: existing.map((s) => s.id),
      counts: health.counts,
      warnings: health.warnings,
    });
  } catch (err) {
    // A failure here can leave NO snapshot — the delete may have succeeded before the create
    // failed. That is precisely the state an admin must be told about immediately.
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[db-snapshot] rotation failed', msg);
    await notifyAdmin(
      '🚨 NHP: DB snapshot rotation FAILED — there may be no snapshot',
      [
        'Snapshot rotation failed partway. The previous snapshot may already have been deleted,',
        'which would leave NO snapshot at all. Verify in the Neon console and take one manually.',
        '',
        `Error: ${msg}`,
        '',
        'The database itself passed its health check before this ran, so the data is fine —',
        'this is a backup-coverage problem, not a data problem.',
      ].join('\n'),
    ).catch(() => {});
    return NextResponse.json({ ok: false, reason: 'rotation-failed', error: msg }, { status: 500 });
  }
}

/** First address in ADMIN_EMAILS — the same list that grants ADMIN at sign-in. */
async function notifyAdmin(subject: string, text: string): Promise<void> {
  const to = (process.env.ADMIN_EMAILS ?? '').split(',')[0]?.trim();
  if (!to) {
    console.error('[db-snapshot] ADMIN_EMAILS unset — cannot notify anyone', { subject });
    return;
  }
  const esc = (v: string) =>
    v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  await sendEmail({
    to,
    subject,
    text,
    html: `<pre style="font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap">${esc(text)}</pre>`,
    // Keyed on the DAY, not the week. Resend de-duplicates for 24h, so this suppresses a
    // double-fire or a Vercel retry on the same day while still letting next week's run send.
    // Keying it on anything coarser would silence a genuine second failure.
    idempotencyKey: `db-snapshot/${new Date().toISOString().slice(0, 10)}/${subject.slice(0, 40)}`,
    tags: [{ name: 'type', value: 'db-snapshot' }],
  });
}
