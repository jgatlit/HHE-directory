import { del, list, put } from '@vercel/blob';
import { prisma } from '@/lib/prisma';

/**
 * Daily logical backup of the whole database to Vercel Blob, with 30-day retention.
 *
 * WHY THIS EXISTS ALONGSIDE THE NEON SNAPSHOT. Neon's Free plan holds exactly ONE manual
 * snapshot, so the weekly snapshot cron must delete before it creates — a window with no
 * snapshot at all. This has no such window and keeps 30 days of history, which is the property
 * that actually matters after 2026-08-27, when a `migrate diff --shadow-database-url` aimed at
 * production dropped every table. Recovery that day depended on a single copy existing.
 *
 * Two independent mechanisms with different failure modes is the point: the snapshot restores
 * instantly but is one-deep; this is a script-restore but thirty-deep, and it uses only
 * already-provisioned Vercel resources.
 *
 * ⚠️ SCALING LIMIT, stated because it will not announce itself. Every table is read fully into
 * memory and serialised in one pass. At today's size (15 practitioners, ~34 MB, low hundreds of
 * rows) that is trivial. The table that grows without bound is `BookingIntent` — one row per
 * booking attempt, forever. When this starts running long or hitting memory, the fix is to stream
 * per-table rather than to raise the timeout.
 */

/** Tables in dependency order, so a restore can insert them front to back without FK violations. */
const TABLES = [
  'city',
  'specialty',
  'specialtyAlias',
  'user',
  'account',
  'practitioner',
  'bookingLink',
  'practitionerSpecialty',
  'caseStudy',
  'whopProduct',
  'bookingIntent',
  'invitation',
  'emailChangeRequest',
  'whopWebhookEvent',
] as const;

/**
 * `Session` and `VerificationToken` are deliberately EXCLUDED. They are short-lived auth
 * artefacts, they are the highest-value rows in the database to an attacker who obtains a backup,
 * and restoring a stale session token is worse than useless. A restore signs everyone in again by
 * magic link; it does not need their old sessions.
 */

export type BackupResult = {
  pathname: string;
  url: string;
  bytes: number;
  rows: Record<string, number>;
  pruned: string[];
};

export const BACKUP_PREFIX = 'db-backups/';
export const RETENTION_DAYS = 30;

/**
 * The PRIVATE blob store's token — NOT `BLOB_READ_WRITE_TOKEN`.
 *
 * ⚠️ THIS MUST BE PINNED ON EVERY CALL. The project has two blob stores and the SDK defaults to
 * whichever token it finds in the environment: `hhe-directory-blob-public` (practitioner photos,
 * which must be publicly readable) and `nhp-db-backups` (private). Falling back to the default
 * would write a full PII dump into the PUBLIC store.
 *
 * That is not hypothetical: an earlier revision did exactly that — `access: 'public'` with
 * `addRandomSuffix: false`, putting every user email and every buyer's name, email and phone at a
 * GUESSABLE url on a store whose id already appears in the page source of every practitioner
 * photo. It was deleted within two minutes and never deployed. Store access is IMMUTABLE in
 * Vercel, which is why the fix was a second store rather than a setting.
 */
function backupToken(): string {
  const token = process.env.BACKUP_BLOB_READ_WRITE_TOKEN;
  if (!token) {
    // Refuse rather than silently fall back to the public store's token.
    throw new Error(
      'BACKUP_BLOB_READ_WRITE_TOKEN is not set. Refusing to write a database backup, because ' +
        'the default token points at the PUBLIC photo store.',
    );
  }
  return token;
}

/**
 * Never prune below this many backups, no matter how old they are.
 *
 * The failure this prevents: if writes start failing silently (bad credentials, a schema change
 * this file does not know about) while pruning keeps running, retention would walk the archive to
 * zero and the first anyone knows is when they need it. Age alone is not a safe delete criterion
 * when the thing producing new copies may be broken.
 */
const MIN_RETAINED = 7;

export async function backupToBlob(): Promise<BackupResult> {
  const rows: Record<string, number> = {};
  const data: Record<string, unknown[]> = {};

  for (const table of TABLES) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (prisma as any)[table];
    if (!model?.findMany) throw new Error(`unknown model in TABLES: ${table}`);
    const records = await model.findMany();
    data[table] = records;
    rows[table] = records.length;
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');
  const payload = JSON.stringify(
    {
      takenAt: new Date().toISOString(),
      // Recorded so a restore can tell whether the dump predates a migration it needs.
      schemaVersion: rows.__migrations ?? null,
      rows,
      data,
    },
    // Dates serialise to ISO strings by default; BigInt does not serialise at all and would throw
    // silently mid-write, so it is coerced rather than left to blow up on some future column.
    (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
  );

  const blob = await put(`${BACKUP_PREFIX}${stamp}.json`, payload, {
    token: backupToken(),
    // PRIVATE — requires authentication to read. See backupToken() for why this needs its own
    // store rather than a flag on the existing one.
    access: 'private',
    contentType: 'application/json',
    // Predictable pathname is safe now that access is private, and the retention scan needs to
    // parse dates back out of the names it finds.
    addRandomSuffix: false,
  });

  return { pathname: blob.pathname, url: blob.url, bytes: payload.length, rows, pruned: [] };
}

/**
 * Delete backups older than RETENTION_DAYS — but only ever after a NEW one has been written, and
 * never below MIN_RETAINED. Call this only on the success path.
 */
export async function pruneOldBackups(): Promise<string[]> {
  const { blobs } = await list({ prefix: BACKUP_PREFIX, token: backupToken() });
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

  const sorted = [...blobs].sort(
    (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
  );

  // Age alone is not sufficient — keep the newest MIN_RETAINED regardless.
  const candidates = sorted
    .slice(MIN_RETAINED)
    .filter((b) => new Date(b.uploadedAt).getTime() < cutoff);

  const pruned: string[] = [];
  for (const b of candidates) {
    await del(b.url, { token: backupToken() });
    pruned.push(b.pathname);
  }
  return pruned;
}

/** Newest-first listing, for the admin view and for a restore to choose from. */
export async function listBackups() {
  const { blobs } = await list({ prefix: BACKUP_PREFIX, token: backupToken() });
  return blobs
    .map((b) => ({ pathname: b.pathname, url: b.url, uploadedAt: b.uploadedAt, size: b.size }))
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
}
