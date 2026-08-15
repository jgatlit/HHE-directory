import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createBookingCheckoutConfig } from '@/lib/whop';

/**
 * Guards the production incident of 2026-08-15 and the facts that resolved it.
 *
 * Step 3 shipped mounting a `chs_…` checkout SESSION from `/v1/checkout_sessions` — which is
 * exactly what @whop/checkout's own docstring instructs ("attach metadata by first creating a
 * session through the API and then passing the session id"). Whop's embedded checkout does not
 * resolve those ids. Every buyer who reached payment saw Whop's "Nothing to see here yet" page.
 *
 * Proven by diffing the embed HTML per id type:
 *   /embedded/checkout/chs_…/  → 1.35MB, ZERO product data
 *   /embedded/checkout/ch_…/   → 1.41MB, title + $55.00
 *
 * The original probe checked that the session could be CREATED (201, metadata merged) and called
 * the design validated. Creation success is not renderability — which is why these tests assert
 * on the id PREFIX, the one property that distinguishes a renderable mount from a 404.
 */
const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  process.env.WHOP_COMPANY_API_KEY = 'test-key';
  process.env.WHOP_PARENT_COMPANY_ID = 'biz_test';
});
afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

function mockFetch(body: unknown, ok = true) {
  const spy = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 400,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
  globalThis.fetch = spy;
  return spy as unknown as ReturnType<typeof vi.fn>;
}

const OK = {
  id: 'ch_LavTG3IPI7tQ8T3',
  purchase_url: 'https://whop.com/checkout/plan_e9mowX3Dg6lbs/?session=ch_LavTG3IPI7tQ8T3',
};

const params = {
  planId: 'plan_e9mowX3Dg6lbs',
  practitionerId: 'prac_1',
  offeringId: 'off_1',
  bookingIntentId: 'int_42',
  slug: 'sarah',
  publicToken: 'tok_abc',
};

function sent(spy: ReturnType<typeof vi.fn>) {
  const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
  return { url, body: JSON.parse(String(init.body)) as Record<string, unknown> };
}

describe('createBookingCheckoutConfig', () => {
  it('posts to /checkout_configurations, NOT /checkout_sessions', async () => {
    const spy = mockFetch(OK);
    await createBookingCheckoutConfig(params);
    const { url } = sent(spy);
    expect(url).toContain('/checkout_configurations');
    // The regression that broke production. A chs_ id renders Whop's 404 in the iframe.
    expect(url).not.toContain('/checkout_sessions');
  });

  it('returns a `ch_` id — the only prefix the embedded checkout can mount', async () => {
    mockFetch(OK);
    const r = await createBookingCheckoutConfig(params);
    expect(r.checkoutConfigId).toMatch(/^ch_/);
    expect(r.checkoutConfigId).not.toMatch(/^chs_/);
  });

  it('references the EXISTING plan by plan_id, minting no duplicate product or plan', async () => {
    const spy = mockFetch(OK);
    await createBookingCheckoutConfig(params);
    const { body } = sent(spy);
    expect(body.plan_id).toBe('plan_e9mowX3Dg6lbs');
    // `plan: "plan_…"` and `items: [{plan}]` are both rejected with parameter_invalid (live).
    expect(body.plan).toBeUndefined();
    expect(body.items).toBeUndefined();
    // Pricing must stay defined in one place — a nested plan object would redefine it per buyer.
    expect(typeof body.plan_id).toBe('string');
  });

  it('sets ALL THREE ids in metadata — a fresh configuration inherits none', async () => {
    const spy = mockFetch(OK);
    await createBookingCheckoutConfig(params);
    const { body } = sent(spy);
    // Only a SESSION merged metadata from its configuration. This is a new object, so omitting
    // practitioner_id/offering_id would make Layer Y payments unattributable to a practitioner —
    // the failure Layer X shipped with.
    expect(body.metadata).toEqual({
      practitioner_id: 'prac_1',
      offering_id: 'off_1',
      booking_intent_id: 'int_42',
    });
  });

  it('returns the per-intent purchase_url, so the §8 fallback is attributable', async () => {
    mockFetch(OK);
    const r = await createBookingCheckoutConfig(params);
    // The offering-level purchase_url carries no booking_intent_id; this one does, via its config.
    expect(r.purchaseUrl).toBe(OK.purchase_url);
    expect(r.purchaseUrl).toContain('ch_LavTG3IPI7tQ8T3');
  });

  it('tolerates a missing purchase_url rather than throwing — the embed is the primary path', async () => {
    mockFetch({ id: 'ch_x' });
    const r = await createBookingCheckoutConfig(params);
    expect(r.checkoutConfigId).toBe('ch_x');
    expect(r.purchaseUrl).toBeNull();
  });

  // The §8 hosted fallback must land on the SAME settled page as the embed and the wallet return.
  // The previous `?purchase=success` on the public profile had no handler anywhere and left a
  // buyer who had just paid staring at an ordinary profile page.
  it('returns the buyer to their own booking page, not to the public profile', async () => {
    const spy = mockFetch(OK);
    await createBookingCheckoutConfig(params);
    const { body } = sent(spy);
    expect(body.redirect_url).toContain('/practitioners/sarah/book/tok_abc');
    expect(body.redirect_url).not.toContain('purchase=success');
  });

  it('throws rather than returning a null config when Whop rejects the call', async () => {
    mockFetch({ error: 'nope' }, false);
    await expect(createBookingCheckoutConfig(params)).rejects.toThrow();
  });
});
