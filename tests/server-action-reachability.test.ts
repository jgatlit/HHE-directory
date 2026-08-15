import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

/**
 * Guards the defect class this repo keeps re-hitting: a capability that is complete, correct, and
 * unreachable.
 *
 * `startSubscriptionCheckout` shipped in PR #37 fully working and with NO caller. Nothing caught
 * it — tsc, lint, the suite and the build all pass on an exported function nobody invokes — so the
 * per-practitioner `metadata.practitioner_id` attribution that PR was sold on was never live, and
 * Layer X silently resolved payers by EMAIL for two and a half months. `publishOffering` had the
 * identical shape in the same PR, and `/api/cron/whop-reconcile` shipped unregistered in #55.
 *
 * The common cause is partitioning work by file: the producer gets an owner, the CONSUMER does
 * not, and every individual file is correct. Type checking cannot see it because an uncalled
 * export is perfectly valid TypeScript. So it is asserted structurally instead.
 *
 * This is deliberately a source-text check rather than a runtime one. The thing being asserted is
 * "a call site exists in the shipped tree", which is a property of the tree, not of any execution.
 */

const ROOT = join(__dirname, '..', 'src');
const ACTIONS = 'app/practitioners/[slug]/edit/actions.ts';

/** Server actions that perform a Whop network call and MUST be reachable from the UI. */
const MUST_HAVE_A_CALLER = [
  'startSubscriptionCheckout',
  'startWhopOnboarding',
  'openPayoutPortal',
  'publishOffering',
  'unpublishOffering',
];

/**
 * Public flow routes that must be REACHABLE FROM THE UI, not merely by typing a URL.
 *
 * `/practitioners/[slug]/book` currently fails this deliberately: §17.4a owns the profile CTA
 * hierarchy and has not landed, so the guard records the gap rather than asserting it away.
 * Flip `linked` to true in the PR that wires the CTA — that is the moment this becomes a real
 * assertion instead of a reminder, and it is exactly the step that got skipped for
 * startSubscriptionCheckout (correct, exported, callerless for two and a half months).
 */
const FLOW_ROUTES = [{ path: '/practitioners/', segment: 'book', linked: false, owner: '§17.4a' }];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

const files = walk(ROOT);
const actionsPath = files.find((f) => f.endsWith(ACTIONS.replace(/\//g, require('node:path').sep)));

describe('server-action reachability', () => {
  it('finds the actions module (guards the guard — a moved file must not silently pass)', () => {
    expect(actionsPath).toBeTruthy();
  });

  for (const name of MUST_HAVE_A_CALLER) {
    it(`${name} is exported AND has a call site outside its own module`, () => {
      const source = readFileSync(actionsPath!, 'utf8');
      expect(source, `${name} is no longer exported from actions.ts`).toContain(
        `export async function ${name}`,
      );

      const callers = files.filter((f) => {
        if (f === actionsPath) return false;
        return new RegExp(`\\b${name}\\b`).test(readFileSync(f, 'utf8'));
      });

      expect(
        callers,
        `${name} has no consumer anywhere in src/. It is exported, correct, and unreachable — ` +
          `the exact shape that left Layer X resolving payers by email for 2.5 months.`,
      ).not.toHaveLength(0);
    });
  }
});

describe('flow routes are reachable from the UI', () => {
  for (const route of FLOW_ROUTES) {
    it(`${route.segment} flow — linked from a page: expected ${route.linked}`, () => {
      const linked = files.some(
        (f) => !f.includes(`${sep}book${sep}`) && /href=\{?[`'"][^`'"]*\/book\b/.test(readFileSync(f, 'utf8')),
      );
      expect(
        linked,
        route.linked
          ? `The ${route.segment} flow has no link from any page — it is reachable only by typing a URL.`
          : `The ${route.segment} flow is now linked. ${route.owner} has landed, so flip \`linked\` to true and keep this asserted.`,
      ).toBe(route.linked);
    });
  }
});

describe('cron routes are registered', () => {
  // /api/cron/whop-reconcile shipped in #55 written, documented, and absent from vercel.json —
  // so nothing would ever have invoked it. The route compiling is not evidence it runs.
  it('every src/app/api/cron/* route appears in vercel.json crons', () => {
    const cronDir = join(ROOT, 'app', 'api', 'cron');
    const routes = readdirSync(cronDir).filter((d) =>
      statSync(join(cronDir, d)).isDirectory(),
    );
    const vercelJson = readFileSync(join(__dirname, '..', 'vercel.json'), 'utf8');
    const scheduled = (JSON.parse(vercelJson).crons ?? []) as Array<{ path: string }>;
    const scheduledPaths = scheduled.map((c) => c.path);

    for (const route of routes) {
      expect(
        scheduledPaths,
        `/api/cron/${route} exists but is not in vercel.json — it would never run.`,
      ).toContain(`/api/cron/${route}`);
    }
  });
});
