import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Bulk invite (2026-08-25): admin pastes a list of emails on /admin/invites instead of sending
 * one at a time. `createInvitationsBulk` reuses the same `inviteOne` core as the single-invite
 * action per address — this pins that the per-address outcome logic (idempotency, rollback on a
 * failed send) and the batch-level parsing/dedup both hold.
 *
 * Mirrors the pattern in tests/invite-trial-reset-and-email.test.ts: the real actions live in a
 * `'use server'` file whose import graph pulls in next/navigation + the whole auth stack, so the
 * core logic is transcribed here and the production source is pinned by regex at the bottom to
 * catch drift.
 */

type InviteOutcome = 'created' | 'reused' | 'invalid' | 'send-failed';

const mocks = vi.hoisted(() => ({
  invitationFindFirst: vi.fn(),
  invitationCreate: vi.fn(),
  invitationDelete: vi.fn(),
  sendInviteMagicLink: vi.fn(),
}));

beforeEach(() => {
  mocks.invitationFindFirst.mockReset().mockResolvedValue(null);
  mocks.invitationCreate.mockReset().mockImplementation(async ({ data }) => ({ id: `row_${data.email}` }));
  mocks.invitationDelete.mockReset().mockResolvedValue({});
  mocks.sendInviteMagicLink.mockReset().mockResolvedValue(true);
});

async function inviteOne(rawEmail: string, invitedById: string): Promise<InviteOutcome> {
  const email = rawEmail.trim().toLowerCase();
  if (!email || !email.includes('@')) return 'invalid';

  const existing = await mocks.invitationFindFirst({ where: { email } });

  let createdId: string | null = null;
  if (!existing) {
    const row = await mocks.invitationCreate({ data: { email, invitedById } });
    createdId = row.id;
  }

  const sent = await mocks.sendInviteMagicLink(email);
  if (!sent) {
    if (createdId) await mocks.invitationDelete({ where: { id: createdId } });
    return 'send-failed';
  }

  return existing ? 'reused' : 'created';
}

function parseBulkEmails(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
}

async function bulkInvite(raw: string, invitedById: string) {
  const candidates = parseBulkEmails(raw);
  const seen = new Set<string>();
  let created = 0;
  let reused = 0;
  let invalid = 0;
  let failed = 0;

  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    const outcome = await inviteOne(candidate, invitedById);
    if (outcome === 'created') created += 1;
    else if (outcome === 'reused') reused += 1;
    else if (outcome === 'invalid') invalid += 1;
    else failed += 1;
  }

  return { created, reused, invalid, failed };
}

describe('bulk invite parsing', () => {
  it('splits on newlines, commas, and semicolons', () => {
    expect(parseBulkEmails('a@x.com\nb@x.com,c@x.com;d@x.com')).toEqual([
      'a@x.com',
      'b@x.com',
      'c@x.com',
      'd@x.com',
    ]);
  });

  it('drops blank lines from a ragged paste', () => {
    expect(parseBulkEmails('a@x.com\n\n\nb@x.com\n')).toEqual(['a@x.com', 'b@x.com']);
  });
});

describe('bulk invite outcomes', () => {
  it('creates each new valid address', async () => {
    const result = await bulkInvite('a@x.com\nb@x.com', 'admin_1');
    expect(result).toEqual({ created: 2, reused: 0, invalid: 0, failed: 0 });
    expect(mocks.invitationCreate).toHaveBeenCalledTimes(2);
  });

  it('dedupes case-insensitively within one paste — never double-invites', async () => {
    const result = await bulkInvite('a@x.com\nA@X.COM\na@x.com', 'admin_1');
    expect(result).toEqual({ created: 1, reused: 0, invalid: 0, failed: 0 });
    expect(mocks.invitationCreate).toHaveBeenCalledTimes(1);
  });

  it('reuses a pending invitation instead of creating a duplicate row', async () => {
    mocks.invitationFindFirst.mockResolvedValue({ token: 'tok', email: 'a@x.com' });
    const result = await bulkInvite('a@x.com', 'admin_1');
    expect(result).toEqual({ created: 0, reused: 1, invalid: 0, failed: 0 });
    expect(mocks.invitationCreate).not.toHaveBeenCalled();
  });

  it('counts unusable addresses as invalid without touching the database', async () => {
    const result = await bulkInvite('not-an-email\na@x.com', 'admin_1');
    expect(result).toEqual({ created: 1, reused: 0, invalid: 1, failed: 0 });
    expect(mocks.invitationCreate).toHaveBeenCalledTimes(1);
  });

  it('counts a failed send and rolls back the row it created for that address', async () => {
    mocks.sendInviteMagicLink.mockImplementation(async (email: string) => email !== 'bad@x.com');
    const result = await bulkInvite('good@x.com\nbad@x.com', 'admin_1');
    expect(result).toEqual({ created: 1, reused: 0, invalid: 0, failed: 1 });
    expect(mocks.invitationDelete).toHaveBeenCalledWith({ where: { id: 'row_bad@x.com' } });
    expect(mocks.invitationDelete).toHaveBeenCalledTimes(1);
  });

  it('one bad address in a batch does not stop the rest from sending', async () => {
    const result = await bulkInvite('a@x.com\nnope\nb@x.com', 'admin_1');
    expect(result.created).toBe(2);
    expect(result.invalid).toBe(1);
  });
});

describe('the production source still carries the shared core + batch semantics', () => {
  const src = () =>
    require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', 'src', 'app', 'admin', 'invites', 'actions.ts'),
      'utf8',
    );

  it('createInvitation and createInvitationsBulk both route through inviteOne', () => {
    const s = src();
    expect(s).toMatch(/async function inviteOne\(/);
    expect(s).toMatch(/const outcome = await inviteOne\(email, session\.user\.id\);/);
    expect(s).toMatch(/const outcome = await inviteOne\(candidate, session\.user\.id\);/);
  });

  it('bulk invite sends sequentially, not via Promise.all', () => {
    const s = src();
    const bulkFn = s.slice(s.indexOf('export async function createInvitationsBulk'));
    expect(bulkFn).toMatch(/for \(const candidate of candidates\) \{/);
    expect(bulkFn).not.toMatch(/Promise\.all/);
  });

  it('bulk invite dedupes case-insensitively before inviting', () => {
    const s = src();
    expect(s).toMatch(/const seen = new Set<string>\(\);/);
    expect(s).toMatch(/if \(seen\.has\(normalized\)\) continue;/);
  });
});
