import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Only the OWNER of a profile, or an ADMIN, may write to it.
 *
 * That rule holds today on every surface — but nothing asserted it. `authorizeForSlug` could be
 * weakened, or a fifth exported action added without it, and `tsc`, `eslint` and the entire suite
 * would stay green: an unauthorized write is perfectly valid TypeScript. Middleware does NOT
 * cover this. It requires only a SESSION on `/practitioners/[slug]/edit`, never ownership, so
 * every one of these gates is the only thing standing between a signed-in practitioner and
 * someone else's profile.
 *
 * Source-text assertions, deliberately, for the same reason as
 * tests/server-action-reachability.test.ts: the property is "this gate exists in the shipped
 * tree". vitest runs a node environment here with no request context to exercise it in.
 */

const ROOT = join(__dirname, '..', 'src');

const EDIT_ACTIONS = join(ROOT, 'app', 'practitioners', '[slug]', 'edit', 'actions.ts');
const EDIT_PAGE = join(ROOT, 'app', 'practitioners', '[slug]', 'edit', 'page.tsx');

/** Every surface that writes practitioner-owned data, and the gate each one must carry. */
const GUARDED_SURFACES = [
  { path: join(ROOT, 'app', 'api', 'practitioners', '[slug]', 'photo', 'route.ts'), what: 'photo upload' },
  { path: join(ROOT, 'app', 'api', 'whop', 'onboarding', 'refresh', 'route.ts'), what: 'whop onboarding refresh' },
  { path: join(ROOT, 'app', 'api', 'whop', 'onboarding', 'return', 'route.ts'), what: 'whop onboarding return' },
];

describe('guarding the guard', () => {
  // A moved or renamed file must FAIL here rather than silently satisfy zero assertions.
  it('every audited file still exists at its expected path', () => {
    for (const p of [EDIT_ACTIONS, EDIT_PAGE, ...GUARDED_SURFACES.map((s) => s.path)]) {
      expect(existsSync(p), `${p} is gone — this suite is asserting nothing about it`).toBe(true);
    }
  });
});

describe('authorizeForSlug is a real owner-or-admin gate', () => {
  const src = () => readFileSync(EDIT_ACTIONS, 'utf8');

  it('compares the practitioner to the SESSION user, not to a request parameter', () => {
    expect(src()).toMatch(/const isOwner = practitioner\.userId === session\.user\.id/);
  });

  it('admits admins', () => {
    expect(src()).toMatch(/const isAdmin = session\.user\.role === 'ADMIN'/);
  });

  it('REJECTS someone who is neither — the assertion the whole rule rests on', () => {
    expect(
      src(),
      'authorizeForSlug no longer rejects a non-owner non-admin: any signed-in practitioner ' +
        'can now write to any other practitioner\'s profile',
    ).toMatch(/if \(!isOwner && !isAdmin\)/);
  });

  it('merges "not found" into the same rejection (IDOR discipline — no existence oracle)', () => {
    // A distinguishable 404-vs-403 lets an attacker enumerate which slugs exist.
    expect(src()).toMatch(/if \(!practitioner\) \{[\s\S]{0,80}AccessDenied/);
  });
});

describe('every exported edit action is gated', () => {
  const src = readFileSync(EDIT_ACTIONS, 'utf8');
  const exported = Array.from(src.matchAll(/export async function (\w+)\s*\(/g)).map((m) => m[1]!);

  it('finds the exported actions at all', () => {
    expect(exported.length, 'no exported server actions found — the regex or the file changed').toBeGreaterThan(0);
  });

  // Enumerated from the file rather than hard-coded, so a NEW action is covered the day it lands
  // instead of the day someone remembers to add it here.
  for (const name of exported) {
    it(`${name} calls authorizeForSlug`, () => {
      const start = src.indexOf(`export async function ${name}`);
      const next = exported
        .map((n) => src.indexOf(`export async function ${n}`))
        .filter((i) => i > start)
        .sort((a, b) => a - b)[0] ?? src.length;
      const body = src.slice(start, next);
      expect(
        body,
        `${name} writes practitioner data without calling authorizeForSlug — it is reachable ` +
          'by any signed-in user for any slug.',
      ).toMatch(/authorizeForSlug\(/);
    });
  }
});

describe('the edit page itself is gated, not just the actions', () => {
  it('redirects a viewer who is neither owner nor admin', () => {
    // Middleware only requires a session here, so without this the dashboard — including the
    // practitioner's lead list and booking intents — renders for any signed-in user.
    expect(readFileSync(EDIT_PAGE, 'utf8')).toMatch(/if \(!isOwner && !isViewerAdmin\)/);
  });

  it('keeps VIEWER role and OWNER role distinct', () => {
    // Conflating them told Amy every pilot she inspected was "exempt from the listing
    // subscription", because the viewer's admin exemption was rendered as the owner's.
    const src = readFileSync(EDIT_PAGE, 'utf8');
    expect(src).toMatch(/isViewerAdmin = session\.user\.role === 'ADMIN'/);
    expect(src).toMatch(/ownerIsAdmin = practitioner\.user\.role === 'ADMIN'/);
  });
});

describe('the non-action write surfaces carry the same gate', () => {
  for (const { path, what } of GUARDED_SURFACES) {
    it(`${what} checks owner-or-admin`, () => {
      const src = readFileSync(path, 'utf8');
      expect(src, `${what}: no isOwner check`).toMatch(/isOwner/);
      expect(src, `${what}: no isAdmin check`).toMatch(/isAdmin/);
      expect(
        /!isOwner && !isAdmin|isOwner \|\| isAdmin/.test(src),
        `${what}: isOwner/isAdmin are computed but never combined into a decision`,
      ).toBe(true);
    });
  }
});
