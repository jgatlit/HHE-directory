import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The /admin/invites directory controls: delist (hide from discovery) and archive (soft delete).
 *
 * The assertions below are almost entirely about the TYPESENSE half, because that is the half
 * that can fail while the screen says it worked. Flipping `delistedAt` in Postgres is atomic and
 * reliable; pushing the removal to a separate search service is neither. `deleteFromIndex()`
 * swallows every error in a bare catch — which is why `indexPractitionerVerified()` exists and
 * why "the delete threw a real error" and "the document was already absent" must not collapse
 * into the same answer.
 */

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  del: vi.fn(),
  retrieve: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { practitioner: { findUnique: mocks.findUnique } },
}));
vi.mock('@/lib/typesense-server', () => ({
  TYPESENSE_COLLECTION: 'practitioners',
  getTypesenseAdmin: () => ({
    collections: () => ({
      documents: (id?: string) =>
        id === undefined
          ? { upsert: mocks.upsert, import: vi.fn() }
          : { delete: mocks.del, retrieve: mocks.retrieve },
    }),
  }),
}));

import { indexPractitionerVerified } from '@/lib/practitioner-indexer';

function notFound() {
  return Object.assign(new Error('Not Found'), { httpStatus: 404 });
}

/** A complete, listable profile. Overrides push it into whichever state a test needs. */
function practitioner(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prac_1',
    slug: 'jane-doe',
    displayName: 'Jane Doe',
    bio: 'A bio comfortably past the twenty-character completeness minimum.',
    photoUrl: null,
    city: { id: 'city_1', name: 'Atlanta', state: 'GA', slug: 'atlanta-ga' },
    cityId: 'city_1',
    specialties: [
      { specialtyId: 'spec_1', rawLabel: null, specialty: { id: 'spec_1', name: 'Acupuncture', slug: 'acupuncture', parent: null } },
    ],
    latitude: null,
    longitude: null,
    acceptedAt: new Date('2026-05-29T00:00:00Z'),
    yearsInPractice: 8,
    searchText: 'jane doe acupuncture',
    subscriptionStatus: 'NONE',
    trialEndsAt: null,
    delistedAt: null,
    archivedAt: null,
    user: { role: 'PRACTITIONER' },
    ...overrides,
  };
}

const KEY = 'TYPESENSE_ADMIN_API_KEY';
let saved: string | undefined;

beforeEach(() => {
  saved = process.env[KEY];
  process.env[KEY] = 'test-key';
  mocks.findUnique.mockReset();
  mocks.upsert.mockReset().mockResolvedValue({});
  mocks.del.mockReset().mockResolvedValue({});
  mocks.retrieve.mockReset();
});
afterEach(() => {
  if (saved === undefined) delete process.env[KEY];
  else process.env[KEY] = saved;
});

describe('indexPractitionerVerified — listing a practitioner', () => {
  it('upserts and confirms the document is present', async () => {
    mocks.findUnique.mockResolvedValue(practitioner());
    mocks.retrieve.mockResolvedValue({ id: 'prac_1' });

    const res = await indexPractitionerVerified('prac_1');

    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.del).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true, listed: true, verified: true });
  });
});

describe('indexPractitionerVerified — delisting', () => {
  it('deletes the document and confirms it is gone', async () => {
    mocks.findUnique.mockResolvedValue(practitioner({ delistedAt: new Date() }));
    mocks.retrieve.mockRejectedValue(notFound());

    const res = await indexPractitionerVerified('prac_1');

    expect(mocks.del).toHaveBeenCalledTimes(1);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true, listed: false, verified: true });
  });

  it('archiving delists too', async () => {
    mocks.findUnique.mockResolvedValue(practitioner({ archivedAt: new Date() }));
    mocks.retrieve.mockRejectedValue(notFound());

    const res = await indexPractitionerVerified('prac_1');
    expect(res).toEqual({ ok: true, listed: false, verified: true });
  });

  it('a 404 on delete means already absent — success, not failure', async () => {
    mocks.findUnique.mockResolvedValue(practitioner({ delistedAt: new Date() }));
    mocks.del.mockRejectedValue(notFound());
    mocks.retrieve.mockRejectedValue(notFound());

    const res = await indexPractitionerVerified('prac_1');
    expect(res).toEqual({ ok: true, listed: false, verified: true });
  });
});

describe('indexPractitionerVerified — the failures deleteFromIndex used to swallow', () => {
  it('a NON-404 delete error is reported, not eaten', async () => {
    mocks.findUnique.mockResolvedValue(practitioner({ delistedAt: new Date() }));
    mocks.del.mockRejectedValue(Object.assign(new Error('Service Unavailable'), { httpStatus: 503 }));

    const res = await indexPractitionerVerified('prac_1');

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toMatch(/write-failed/);
  });

  it('the document still being present after a delist is a MISMATCH, not a success', async () => {
    mocks.findUnique.mockResolvedValue(practitioner({ delistedAt: new Date() }));
    mocks.retrieve.mockResolvedValue({ id: 'prac_1' }); // delete "succeeded" but it is still there

    const res = await indexPractitionerVerified('prac_1');

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toMatch(/mismatch/);
  });

  it('a verify-time error is reported rather than read as absent', async () => {
    mocks.findUnique.mockResolvedValue(practitioner({ delistedAt: new Date() }));
    mocks.retrieve.mockRejectedValue(new Error('network down'));

    const res = await indexPractitionerVerified('prac_1');

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toMatch(/verify-failed/);
  });

  it('an unknown practitioner is a failure, not a silent no-op', async () => {
    mocks.findUnique.mockResolvedValue(null);
    const res = await indexPractitionerVerified('nope');
    expect(res).toEqual({ ok: false, reason: 'practitioner-not-found' });
  });
});

describe('indexPractitionerVerified — Typesense not configured', () => {
  it('reports verified:false rather than claiming a confirmed sync', async () => {
    delete process.env[KEY];
    mocks.findUnique.mockResolvedValue(practitioner());

    const res = await indexPractitionerVerified('prac_1');

    expect(res).toEqual({ ok: true, listed: true, verified: false });
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.del).not.toHaveBeenCalled();
  });
});

describe('the controls are reachable from the admin UI', () => {
  // Same defect class as tests/server-action-reachability.test.ts: an exported, correct,
  // callerless server action passes tsc, lint, the suite and the build.
  const page = readFileSync(
    join(__dirname, '..', 'src', 'app', 'admin', 'invites', 'page.tsx'),
    'utf8',
  );

  for (const action of ['setDelisted', 'setArchived']) {
    it(`${action} is submitted by a form on the invites page`, () => {
      expect(page).toContain(action);
      expect(page, `${action} is imported but never used as a form action`).toMatch(
        new RegExp(`action=\\{${action}\\}`),
      );
    });
  }

  it('resolves the practitioner by email, not only by acceptedByUser', () => {
    // Twelve of eighteen invitations were never accepted, and their practitioners are exactly
    // the ones an operator needs to hide. Keying only off acceptedByUser hides the controls
    // from them while looking correct on the four accepted rows.
    expect(page).toMatch(/byEmail/);
    expect(page).toMatch(/resolve\(inv\.email\)/);
  });
});
