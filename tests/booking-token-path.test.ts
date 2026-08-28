import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE BOOKING TOKEN MUST NEVER APPEAR IN A QUERY STRING.
 *
 * `/practitioners/[slug]/book/[token]` loads third-party scheduler scripts into OUR OWN document
 * (SchedulerFrame's loadScript → assets.calendly.com, app.cal.com). They run with our origin's
 * privileges on a page holding an unauthenticated bearer token — the one §10 emails to buyers —
 * alongside the buyer's name and email in the capture form's DOM.
 *
 * Both vendor scripts were read rather than assumed. Neither reads the PATH. Both read the QUERY
 * STRING. So the token's safety rests entirely on it being a path segment — an accident of URL
 * shape, with no CSP behind it: the vendor-allowlist CSP was deliberately rejected
 * (tsk_ead0934c, operator ruling 2026-08-28), so `connect-src` is `https:` and bounds nothing.
 *
 * These assertions ARE the control. Source-text, because the property is "no code anywhere puts
 * this token in a query string" — a claim about the shipped tree that no runtime test can make.
 */

const ROOT = join(__dirname, '..', 'src');
const BOOK = join(ROOT, 'app', 'practitioners', '[slug]', 'book');
const read = (p: string) => readFileSync(p, 'utf8');

/**
 * Strip comments before scanning for CODE patterns.
 *
 * Caught by this test failing on its first run: the warning comment at the construction site
 * contains the literal `?token=`, so the scanner flagged the very file whose documentation it was
 * reading. A guard that trips on its own warning text is worse than none — it would be silenced.
 *
 * ⚠️ COMMENT-ONLY LINES AND BLOCK COMMENTS, DELIBERATELY NOT A GENERAL STRIPPER. Removing
 * everything after `//` on any line would eat `https://…` inside string literals and truncate
 * real code — turning a security scanner's false positives into FALSE NEGATIVES, which is the
 * one failure mode it must not have. A trailing comment on a code line survives here and can
 * only cause a false positive, which is the safe direction to be wrong in.
 */
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join('\n');

const ACTIONS = join(BOOK, 'actions.ts');
const TOKEN_PAGE = join(BOOK, '[token]', 'page.tsx');

describe('the booking token stays in the URL PATH', () => {
  it('the route is a path segment — the [token] dynamic segment exists', () => {
    expect(
      existsSync(TOKEN_PAGE),
      'the [token] path segment is gone; the token has moved somewhere else',
    ).toBe(true);
    expect(read(TOKEN_PAGE)).toMatch(/params:\s*\{[^}]*token:\s*string/);
  });

  it('builds nextUrl with the token as a path segment', () => {
    expect(read(ACTIONS)).toMatch(/\/book\/\$\{intent\.publicToken\}/);
  });

  /**
   * THE REGRESSION GUARD. A refactor that moved the token to `?token=` would still work, still
   * pass every other test, and silently hand the credential to Calendly on the next page load.
   */
  it('NO file under book/ ever puts the token in a query string', () => {
    const files = [ACTIONS, TOKEN_PAGE, join(BOOK, 'page.tsx')].filter(existsSync);
    const offenders: string[] = [];
    for (const f of files) {
      const src = stripComments(read(f));
      // `?token=`/`&token=` in a literal, or a searchParams write naming a token.
      if (/[?&]token=/i.test(src)) offenders.push(`${f}: literal ?token=`);
      if (/searchParams\.(set|append)\(\s*['"`][^'"`]*token/i.test(src)) {
        offenders.push(`${f}: searchParams.set(...token...)`);
      }
      if (/publicToken[^\n]*searchParams|searchParams[^\n]*publicToken/i.test(src)) {
        offenders.push(`${f}: publicToken near searchParams`);
      }
    }
    expect(
      offenders,
      'the booking token must never reach a query string — vendor scripts read window.location.search',
    ).toEqual([]);
  });

  it('the rule is documented where the URL is built, not only here', () => {
    const src = read(ACTIONS);
    expect(
      src,
      'the constraint must be stated at the construction site, or the next refactor will not know',
    ).toMatch(/NEVER A QUERY PARAMETER/);
  });
});

describe('HOST_MAP is marked as the security boundary its sibling is not', () => {
  /**
   * `BOOKING_HOSTS` (edit/actions.ts) says "Do not read this array as a security boundary" and is
   * right to. HOST_MAP looks almost identical but decides which adapter runs — and the cal.com
   * adapter feeds `url.origin` to `Cal('init', { origin })`. The hazard is a reader carrying the
   * sibling's model across.
   */
  it('booking-providers.ts states that it IS one', () => {
    expect(read(join(ROOT, 'lib', 'booking-providers.ts'))).toMatch(/IS\* A SECURITY BOUNDARY|IS A SECURITY BOUNDARY/);
  });

  it('the cal.com adapter still derives origin from the parsed URL', () => {
    expect(read(join(ROOT, 'lib', 'scheduler-adapters.ts'))).toMatch(/origin:\s*url\.origin/);
  });
});
