import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createBookingCheckoutSession } from '@/lib/whop';

/**
 * Guards the two facts established by probing the live API on 2026-08-15, both of which the
 * task's written contract had wrong:
 *
 *   1. The mount source is `checkout_configuration`, NOT `plan_id`. Posting plan_id alone returns
 *      `mount_source_required: provide exactly one of items, checkout_configuration or link`.
 *   2. The route is v1. `/v2/checkout_sessions` 404s — it resolves the trailing segment as a plan
 *      id ("No such Plan found with the provided ID: checkout_sessions").
 *
 * And the property the whole option-(a) decision exists for: `booking_intent_id` must be in the
 * session metadata, because that is what lets `payment.succeeded` reconcile to a BookingIntent
 * server-side rather than trusting a client callback that a buyer can close the tab on.
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
    status: ok ? 201 : 400,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
  globalThis.fetch = spy;
  return spy as unknown as ReturnType<typeof vi.fn>;
}

describe('createBookingCheckoutSession', () => {
  it('mounts on the checkout CONFIGURATION, never plan_id', async () => {
    const spy = mockFetch({ id: 'chs_abc' });
    await createBookingCheckoutSession({
      checkoutConfigurationId: 'ch_cfg1',
      bookingIntentId: 'int_1',
    });

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(String(init.body));
    expect(sent.checkout_configuration).toBe('ch_cfg1');
    // Posting plan_id alone is rejected with mount_source_required.
    expect(sent.plan_id).toBeUndefined();
    expect(url).toContain('/checkout_sessions');
    // v2 resolves the path segment as a plan id and 404s.
    expect(url).not.toContain('/v2/');
  });

  it('attaches booking_intent_id — the whole reason a per-booking session exists', async () => {
    const spy = mockFetch({ id: 'chs_abc' });
    await createBookingCheckoutSession({
      checkoutConfigurationId: 'ch_cfg1',
      bookingIntentId: 'int_42',
    });
    const sent = JSON.parse(String((spy.mock.calls[0] as [string, RequestInit])[1].body));
    expect(sent.metadata).toEqual({ booking_intent_id: 'int_42' });
  });

  it('returns the chs_ session id — NOT the ch_ configuration id the embed would reject', async () => {
    mockFetch({ id: 'chs_zQOPWRnJVS3i7K' });
    const r = await createBookingCheckoutSession({
      checkoutConfigurationId: 'ch_cfg1',
      bookingIntentId: 'int_1',
    });
    expect(r.sessionId).toBe('chs_zQOPWRnJVS3i7K');
    expect(r.sessionId).not.toBe('ch_cfg1');
  });

  it('does NOT send a redirect_url — the configuration overrides it, so it would be a lie', async () => {
    // Verified live: a session-level redirect_url is silently replaced by the configuration's.
    // Per-intent return goes on the embed's `returnUrl` prop instead.
    const spy = mockFetch({ id: 'chs_abc' });
    await createBookingCheckoutSession({
      checkoutConfigurationId: 'ch_cfg1',
      bookingIntentId: 'int_1',
    });
    const sent = JSON.parse(String((spy.mock.calls[0] as [string, RequestInit])[1].body));
    expect(sent.redirect_url).toBeUndefined();
  });

  it('throws rather than returning a null session when Whop rejects the call', async () => {
    mockFetch({ error: 'nope' }, false);
    await expect(
      createBookingCheckoutSession({ checkoutConfigurationId: 'ch_x', bookingIntentId: 'i' }),
    ).rejects.toThrow();
  });
});
