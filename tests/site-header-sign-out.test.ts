import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Sign-out did not exist in the product until 2026-08-18. `signOut` was exported from auth.ts
 * and imported by NOTHING — the same exported-correct-and-unreachable shape that
 * tests/server-action-reachability.test.ts exists to catch, but on a capability the UI never
 * had rather than one it lost.
 *
 * Source-text assertions, like that suite: the property is "this wiring exists in the shipped
 * tree", which vitest cannot observe at runtime here (node environment, no testing-library, so
 * SiteHeader is never rendered by any test).
 */

const ROOT = join(__dirname, '..', 'src');
const HEADER = join(ROOT, 'components', 'site', 'SiteHeader.tsx');
const ACTIONS = join(ROOT, 'components', 'site', 'actions.ts');
const HOME = join(ROOT, 'app', 'page.tsx');

const header = () => readFileSync(HEADER, 'utf8');
const actions = () => readFileSync(ACTIONS, 'utf8');
const home = () => readFileSync(HOME, 'utf8');

describe('sign-out is wired end to end', () => {
  it('the action exists and calls next-auth signOut', () => {
    const src = actions();
    expect(src).toContain("'use server'");
    expect(src).toContain('export async function signOutAction');
    expect(src, 'the action no longer calls signOut — it would resolve without ending the session')
      .toMatch(/await signOut\(/);
  });

  it('the header imports and submits the action', () => {
    const src = header();
    expect(src).toContain('signOutAction');
    expect(src, 'the action must be submitted by a form — a bare onClick cannot reach a server action')
      .toMatch(/<form\s+action=\{signOutAction\}/);
    expect(src).toMatch(/Sign out/);
  });

  it('the homepage renders the header WITH signedIn — the prop is useless unless passed', () => {
    expect(home()).toMatch(/<SiteHeader[^>]*signedIn=/);
  });
});

describe('sign-out is keyed on signedIn, never on profileHref', () => {
  /**
   * The trap this locks down. `profileHref` is null for signed-out visitors AND for signed-in
   * users with no practitioner record, so gating sign-out on it strands admins who own no
   * profile — while looking perfectly correct in review and in manual testing, because all
   * three admins at the time of writing happened to own one.
   */
  it('SiteHeader accepts signedIn as its own prop', () => {
    expect(header()).toMatch(/signedIn\??:\s*boolean/);
  });

  it('the sign-out branch tests signedIn, not profileHref', () => {
    const src = header();
    const branch = src.slice(src.indexOf('<div className="flex shrink-0'));
    expect(branch, 'sign-out is rendered but nothing in that subtree reads signedIn').toMatch(
      /\{signedIn\s*\?/,
    );
    expect(
      /\{profileHref\s*\?[^}]*Sign out/.test(branch),
      'sign-out is branching on profileHref — an admin with no practitioner row loses it',
    ).toBe(false);
  });

  it('a signed-in user is never offered "Sign in"', () => {
    const src = header();
    expect(
      /profileHref\s*\?\?\s*`\$\{SITE_URL\}\/auth\/signin`/.test(src),
      'the slot fell back to the sign-in URL on profileHref again, so a signed-in admin with ' +
        'no profile is sent back through a magic-link round trip',
    ).toBe(false);
  });
});
