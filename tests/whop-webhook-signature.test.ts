import { describe, it, expect, beforeAll } from 'vitest';
import { signWebhook, TEST_SECRET } from './helpers/whop-webhook';

/**
 * Proves the offline signer produces signatures Whop's OWN verifier accepts.
 *
 * Everything else in the webhook suite forges deliveries with this helper, so if the scheme
 * here is wrong every one of those tests would be exercising a rejected request while still
 * passing for the wrong reason. This is the load-bearing assertion under the whole tier.
 */
describe('Standard Webhooks signature round-trip (against the real SDK verifier)', () => {
  let unwrap: (body: string, headers: Record<string, string>) => unknown;

  beforeAll(async () => {
    process.env.WHOP_COMPANY_API_KEY = 'apik_test';
    process.env.WHOP_PARENT_COMPANY_ID = 'biz_test';
    process.env.WHOP_V1_WEBHOOK_SECRET = TEST_SECRET;
    ({ unwrapWebhook: unwrap } = await import('@/lib/whop'));
  });

  it('accepts a correctly signed payload and returns the parsed event', () => {
    const body = JSON.stringify({ type: 'payment.succeeded', data: { id: 'pay_1' } });
    const event = unwrap(body, signWebhook(body)) as { type: string; data: { id: string } };
    expect(event.type).toBe('payment.succeeded');
    expect(event.data.id).toBe('pay_1');
  });

  it('rejects a tampered body', () => {
    const body = JSON.stringify({ type: 'payment.succeeded', data: { id: 'pay_1' } });
    const headers = signWebhook(body);
    const tampered = JSON.stringify({ type: 'payment.succeeded', data: { id: 'pay_ATTACKER' } });
    expect(() => unwrap(tampered, headers)).toThrow();
  });

  it('rejects a signature made with the wrong secret', () => {
    const body = JSON.stringify({ type: 'payment.succeeded', data: {} });
    expect(() => unwrap(body, signWebhook(body, { secret: 'ws_wrong_secret' }))).toThrow();
  });
});
