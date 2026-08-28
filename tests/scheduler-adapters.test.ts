import { describe, it, expect } from 'vitest';
import { schedulerEmbed, splitName, supportsPrefill } from '@/lib/scheduler-adapters';

const LEAD = { name: 'Mary Anne Van Der Berg', email: 'Mary@Example.COM' };

describe('splitName — §6 name handling', () => {
  // Splitting on the LAST whitespace is the intuitive implementation and it is WRONG for exactly
  // the case this rule was written for. Asserted directly so a "tidy-up" cannot silently flip it.
  it('splits on the FIRST whitespace, not the last', () => {
    expect(splitName('Mary Anne Van Der Berg')).toEqual({
      firstName: 'Mary',
      lastName: 'Anne Van Der Berg',
    });
  });

  it('leaves lastName empty for a mononym rather than inventing one', () => {
    // Verified live to render with no error, no aria-invalid, and submit still enabled.
    expect(splitName('Prince')).toEqual({ firstName: 'Prince', lastName: '' });
  });

  it('normalises runs of whitespace', () => {
    expect(splitName('  Ada   Lovelace  ')).toEqual({ firstName: 'Ada', lastName: 'Lovelace' });
  });
});

describe('schedulerEmbed — Calendly', () => {
  const url = 'https://calendly.com/sarah/60min';

  it('hands prefill to the WIDGET API and never to the URL', () => {
    const s = schedulerEmbed(url, LEAD);
    expect(s.kind).toBe('calendly');
    if (s.kind !== 'calendly') throw new Error('narrow');
    expect(s.prefill).toEqual({ name: LEAD.name, email: LEAD.email });
    // ⚠️ THE REGRESSION THIS GUARDS: Calendly prefill travels over postMessage, not as query
    // params. Appending it to the URL does nothing at all — and it looks completely correct in
    // review, because the params are right and simply ignored.
    expect(s.url).not.toContain('name=');
    expect(s.url).not.toContain('email=');
  });

  it('carries a null prefill through rather than fabricating one', () => {
    const s = schedulerEmbed(url, null);
    if (s.kind !== 'calendly') throw new Error('narrow');
    expect(s.prefill).toBeNull();
  });
});

describe('schedulerEmbed — cal.com', () => {
  it('extracts the bare calLink and passes a CONFIG OBJECT', () => {
    const s = schedulerEmbed('https://cal.com/jonathan/30min', LEAD);
    expect(s.kind).toBe('cal_com');
    if (s.kind !== 'cal_com') throw new Error('narrow');
    expect(s.calLink).toBe('jonathan/30min');
    expect(s.origin).toBe('https://cal.com');
    // The config object exists precisely so the script serialises `name` FIRST — a known cal.com
    // bug ignores every prefill param unless it does. Hand-building the query string here would
    // reintroduce that bug in a form that looks identical to working code.
    expect(s.config).toEqual({ name: LEAD.name, email: LEAD.email });
  });

  it('falls back to a plain iframe when there is no event path to embed', () => {
    const s = schedulerEmbed('https://cal.com/', LEAD);
    expect(s.kind).toBe('iframe');
  });
});

describe('schedulerEmbed — Acuity', () => {
  it('uses camelCase name params and a lowercase email param', () => {
    const s = schedulerEmbed('https://sarah.as.me/consult', LEAD);
    expect(s.kind).toBe('iframe');
    if (s.kind !== 'iframe') throw new Error('narrow');
    const params = new URL(s.src).searchParams;

    // ⚠️ snake_case is SILENTLY IGNORED AND STRIPPED by Acuity — a wrong-case attempt is
    // indistinguishable from no prefill at all, on the provider holding the most links we have.
    expect(params.get('firstName')).toBe('Mary');
    expect(params.get('lastName')).toBe('Anne Van Der Berg');
    expect(params.has('first_name')).toBe(false);
    expect(params.has('last_name')).toBe(false);

    // `email` is lowercase-only and parsed independently of the name casing.
    expect(params.get('email')).toBe(LEAD.email);
    expect(params.has('Email')).toBe(false);
  });

  it('resolves every Acuity URL shape to the same adapter', () => {
    for (const u of [
      'https://app.acuityscheduling.com/schedule/abc123',
      'https://secure.acuityscheduling.com/schedule.php?owner=12345',
      'https://sarah.as.me/consult',
    ]) {
      expect(schedulerEmbed(u, null).kind).toBe('iframe');
      expect(supportsPrefill(u)).toBe(true);
    }
  });

  it('omits lastName entirely for a mononym instead of sending an empty one', () => {
    const s = schedulerEmbed('https://sarah.as.me/consult', { name: 'Prince', email: 'p@x.com' });
    if (s.kind !== 'iframe') throw new Error('narrow');
    const params = new URL(s.src).searchParams;
    expect(params.get('firstName')).toBe('Prince');
    expect(params.has('lastName')).toBe(false);
  });
});

describe('schedulerEmbed — the null adapter is first-class (D9)', () => {
  it('embeds an unknown scheduler with no prefill and no resize claim', () => {
    const s = schedulerEmbed('https://bookings.example.com/dr-smith', LEAD);
    expect(s.kind).toBe('iframe');
    if (s.kind !== 'iframe') throw new Error('narrow');
    // The flow must COMPLETE with this installed — so this is a correct outcome, not a failure.
    expect(s.src).not.toContain('email=');
    // The parent cannot measure a cross-origin document, so this frame is viewport-sized.
    expect(s.resizes).toBe(false);
    expect(supportsPrefill('https://bookings.example.com/dr-smith')).toBe(false);
  });

  it('treats an unparseable URL as the null adapter rather than throwing', () => {
    expect(() => schedulerEmbed('not a url at all', LEAD)).not.toThrow();
    expect(schedulerEmbed('not a url at all', LEAD).kind).toBe('iframe');
  });

  it('savvycal.app is NOT SavvyCal and must fall through', () => {
    // A separate product with a different embed element and a split name field. Detecting it as
    // SavvyCal would send prefill params the page ignores, which reads as broken prefill.
    expect(supportsPrefill('https://savvycal.app/x/abc')).toBe(false);
  });
});

describe('schedulerEmbed — D16, derived from the URL and never from the column', () => {
  it('derives Calendly from a URL whose stored provider column says OTHER', () => {
    // THE LIVE ROW. `BookingLink.provider` shipped NOT NULL DEFAULT 'OTHER' with no backfill, and
    // one bookable row still holds a calendly.com URL under OTHER. Reading the column here would
    // drop that practitioner's buyers to the null adapter and silently lose their prefill; nothing
    // in the UI would show it. Deriving cannot go stale.
    const s = schedulerEmbed('https://calendly.com/stale-row/intro', LEAD);
    expect(s.kind).toBe('calendly');
  });

  it('tolerates a scheme-less URL the same way the save path normalises it', () => {
    expect(schedulerEmbed('calendly.com/sarah/60min', null).kind).toBe('calendly');
  });
});

describe('schedulerEmbed — input tolerance (§6)', () => {
  it('strips tracking params but preserves the path and real query', () => {
    const s = schedulerEmbed(
      'https://secure.acuityscheduling.com/schedule.php?owner=12345&utm_source=ig&fbclid=xyz',
      null,
    );
    if (s.kind !== 'iframe') throw new Error('narrow');
    const url = new URL(s.src);
    expect(url.pathname).toBe('/schedule.php');
    // `owner` is what selects the practitioner's calendar — dropping it lands every buyer on a
    // generic page instead.
    expect(url.searchParams.get('owner')).toBe('12345');
    expect(url.searchParams.has('utm_source')).toBe(false);
    expect(url.searchParams.has('fbclid')).toBe(false);
  });
});

describe('the null adapter must not hand a dangerous scheme to an iframe src', () => {
  // Found by security review of PR #97. The catch branch echoed the ORIGINAL string back as
  // `src`, so an unparseable input reached the iframe verbatim. React 18 (this repo) only WARNS
  // on `javascript:` in src — the hard block landed in React 19 — so it would have EXECUTED in
  // our origin, on the page holding the booking token and the buyer's name and email.
  //
  // The /edit save path blocks these, but two writers bypass it entirely:
  // scripts/import-pilot-practitioners.ts (url straight from a JSON file) and seed-verify.ts.
  it('forces http(s) on anything unparseable, so no script-bearing scheme survives', () => {
    for (const hostile of [
      'javascript:alert(document.domain)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'blob:https://calendly.com/abc',
      'not a url at all',
    ]) {
      const s = schedulerEmbed(hostile, { name: 'A B', email: 'a@b.com' });
      const src = s.kind === 'iframe' ? s.src : s.kind === 'calendly' ? s.url : '';
      expect(src.startsWith('https://') || src.startsWith('http://')).toBe(true);
      expect(src.toLowerCase()).not.toMatch(/^javascript:|^data:|^vbscript:|^blob:/);
    }
  });
});
