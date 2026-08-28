import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Navigation reachability — the properties that make the header safe to render off the homepage.
 *
 * Until 2026-08-28 `SiteHeader` rendered on exactly ONE page. Two things followed from that, and
 * both are invisible to tsc, eslint and every runtime test in this suite:
 *
 *   1. A visitor on `/practitioners/[slug]` or `/search` had no route back into the directory.
 *      Per D18 we attribute organic search landings to NHP rather than to the practitioner — so we
 *      were claiming those leads and then dead-ending them.
 *   2. The sign-out shipped in PR #72 lives INSIDE that header, so it was unreachable from every
 *      page except `/`.
 *
 * Source-text assertions, matching the sibling suite: SiteHeader is a client component and no test
 * here renders React, so "does this wiring exist in the shipped tree" is the observable property.
 */

const ROOT = join(__dirname, '..', 'src');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

const header = () => read('components', 'site', 'SiteHeader.tsx');
const search = () => read('app', 'search', 'page.tsx');
const profile = () => read('app', 'practitioners', '[slug]', 'page.tsx');
const home = () => read('app', 'page.tsx');

describe('header fragment links survive leaving the homepage', () => {
  /**
   * THE REGRESSION THIS EXISTS FOR. `#how-it-works` and `#get-listed` are sections of the
   * HOMEPAGE. A bare fragment resolves against whatever page is current, so on `/search` it
   * scrolls nowhere — a dead link that renders, hovers and clicks exactly like a live one, with
   * no error in any log. Root-relative `/#…` is correct everywhere, the homepage included.
   */
  it('has no BARE fragment hrefs anywhere in the header', () => {
    // BOTH syntaxes, deliberately. The NAV entries are object literals (`href: '#x'`) while the
    // CTA is a JSX attribute (`href="#x"`), and an earlier version of this regex matched only the
    // attribute form — so it passed while the two NAV anchors, the likelier regression, went
    // entirely unchecked. Caught by mutation-testing this assertion rather than by reading it.
    const bare = Array.from(
      header().matchAll(/href\s*[:=]\s*[{]?\s*["']#([a-z0-9-]+)/gi),
      (m) => m[1],
    );
    // `#main` is the skip link and is genuinely per-page: every page renders its own <main id>.
    const offenders = bare.filter((f) => f !== 'main');
    expect(
      offenders,
      `bare fragment href(s) ${JSON.stringify(offenders)} point at homepage sections and scroll ` +
        'nowhere on /search or a profile — use /#anchor',
    ).toEqual([]);
  });

  it('the homepage anchors it links to still exist', () => {
    const src = home();
    for (const id of ['how-it-works', 'get-listed']) {
      expect(src, `the header links to /#${id} but the homepage has no such id`).toContain(
        `id="${id}"`,
      );
    }
  });
});

describe('every public page can reach the directory', () => {
  it('/search renders the header, with identity resolved', () => {
    const src = search();
    expect(src).toMatch(/<SiteHeader/);
    // No `s` flag: `[^>]` is a negated class and already matches newlines, so a multi-line
    // <SiteHeader …> is covered — and the flag needs a target this tsconfig does not set.
    expect(src, 'signedIn must be passed or sign-out never renders').toMatch(
      /<SiteHeader[^>]*signedIn=/,
    );
    expect(src, 'the page must be async to await identity').toMatch(
      /export default async function SearchPage/,
    );
  });

  it('/search keeps a <main id="main"> for the header skip link to target', () => {
    expect(search()).toMatch(/<main[^>]*id="main"/);
  });

  /**
   * The profile page deliberately does NOT get SiteHeader — operator ruling 2026-08-27, "a small
   * link/breadcrumb in the top-left, not a full site header", because the page doubles as a
   * practitioner's shareable business card. Asserting the absence keeps a future well-meaning
   * "make it consistent" change from quietly overriding that ruling.
   */
  it('a profile page has a back link to the directory and NOT the full header', () => {
    const src = profile();
    expect(src, 'no route back into the directory').toMatch(/href="\/search"/);
    expect(src, 'SiteHeader here would override the 2026-08-27 ruling').not.toMatch(/<SiteHeader/);
  });

  it('a signed-in owner can sign out from their own profile', () => {
    const src = profile();
    expect(src).toContain('signOutAction');
    expect(src, 'a server action needs a form — an onClick cannot reach one').toMatch(
      /<form\s+action=\{signOutAction\}/,
    );
  });
});
