import { NextResponse } from 'next/server';
import { checkDbHealth } from '@/lib/db-health';
import { backupToBlob, listBackups, pruneOldBackups, RETENTION_DAYS } from '@/lib/db-backup';
import { sendEmail } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * DAILY database backup to Vercel Blob, 30-day retention.
 *
 *   1. Validate the database is healthy — do not archive a wipe.
 *   2. Write a dated JSON export.
 *   3. ONLY THEN prune anything older than 30 days, never below the floor.
 *
 * Ordering matters for the same reason it does in the snapshot cron, though the stakes are lower:
 * here a bad day costs one slot out of thirty rather than the only copy. The gate still runs,
 * because thirty consecutive backups of a wiped database is a slower version of the same disaster.
 *
 * ⚠️ PRUNE ONLY AFTER A SUCCESSFUL WRITE. If writing starts failing silently and pruning keeps
 * running on a schedule, retention walks the archive to zero and nobody finds out until they need
 * it. Age is not a safe delete criterion when the thing producing new copies may be broken.
 *
 * Complements the weekly Neon snapshot rather than duplicating it: the snapshot restores
 * instantly but Neon's Free plan holds exactly ONE, so it is one-deep and has a
 * delete-before-create window. This is thirty-deep with no such window, and needs no credential
 * beyond BLOB_READ_WRITE_TOKEN, which is already provisioned.
 *
 * Auth: same shape as the sibling crons.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // ── 1. VALIDATE ──────────────────────────────────────────────────────────────────────────
  const health = await checkDbHealth();
  if (!health.healthy) {
    const body = [
      "Today's database backup was SKIPPED because the live database failed its health check.",
      '',
      'NOTHING WAS DELETED — every existing backup is intact, and retention does not run on a',
      'skipped day. Those backups are the recovery path; do not run anything destructive.',
      '',
      'Failures:',
      ...health.failures.map((f) => `  - ${f}`),
      '',
      `Row counts: ${JSON.stringify(health.counts)}`,
    ].join('\n');
    console.error('[db-backup] ABORTED — database unhealthy', health.failures);
    await notifyAdmin('🚨 NHP: daily DB backup SKIPPED — database looks damaged', body).catch((e) =>
      console.error('[db-backup] admin email failed', e),
    );
    return NextResponse.json({ ok: false, reason: 'unhealthy', health }, { status: 500 });
  }

  // ── 2. WRITE ─────────────────────────────────────────────────────────────────────────────
  let result;
  try {
    result = await backupToBlob();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[db-backup] write failed', msg);
    await notifyAdmin(
      '🚨 NHP: daily DB backup FAILED to write',
      [
        'The backup could not be written. Existing backups are untouched and retention did NOT',
        'run, so nothing was deleted — but today has no copy.',
        '',
        `Error: ${msg}`,
        '',
        'The database itself passed its health check, so this is a backup-coverage problem, not a',
        'data problem.',
      ].join('\n'),
    ).catch(() => {});
    return NextResponse.json({ ok: false, reason: 'write-failed', error: msg }, { status: 500 });
  }

  // ── 3. PRUNE — only now that a fresh copy exists ─────────────────────────────────────────
  let pruned: string[] = [];
  try {
    pruned = await pruneOldBackups();
  } catch (err) {
    // Non-fatal: a failed prune costs storage, never data. The backup itself succeeded, so this
    // must not turn a good day into a red one.
    console.warn('[db-backup] prune failed (backup itself succeeded)', err);
  }

  const kept = await listBackups().catch(() => []);
  console.warn(
    `[db-backup] wrote ${result.pathname} (${result.bytes} bytes), pruned ${pruned.length}, ${kept.length} retained`,
  );

  return NextResponse.json({
    ok: true,
    pathname: result.pathname,
    bytes: result.bytes,
    rows: result.rows,
    pruned,
    retained: kept.length,
    retentionDays: RETENTION_DAYS,
    warnings: health.warnings,
  });
}

async function notifyAdmin(subject: string, text: string): Promise<void> {
  const to = (process.env.ADMIN_EMAILS ?? '').split(',')[0]?.trim();
  if (!to) {
    console.error('[db-backup] ADMIN_EMAILS unset — cannot notify anyone', { subject });
    return;
  }
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  await sendEmail({
    to,
    subject,
    text,
    html: `<pre style="font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap">${esc(text)}</pre>`,
    // Day-scoped: Resend de-duplicates for 24h, so a retry or double-fire today is suppressed
    // while tomorrow's genuine failure still sends. A coarser key would silence real alerts.
    idempotencyKey: `db-backup/${new Date().toISOString().slice(0, 10)}/${subject.slice(0, 40)}`,
    tags: [{ name: 'type', value: 'db-backup' }],
  });
}
