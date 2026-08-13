import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Covers the transactional email sender.
 *
 * The Resend SDK is mocked; the assertions that matter are about what this wrapper does with the
 * SDK's answers, not about reaching Resend. Two of them are the reason the module exists:
 *
 *  1. The SDK RESOLVES with `{ data, error }` instead of rejecting, so a failed send looks like a
 *     successful call. Every test below that asserts a throw is guarding against this codebase's
 *     recurring failure mode — a send that quietly reports success and leaves a counter at zero.
 *  2. `idempotencyKey` must reach the SDK, because every caller is a cron or a webhook and Whop
 *     and Vercel both retry. If it is silently dropped, nothing fails — people just get emailed
 *     twice, which no test would otherwise catch.
 */

const send = vi.fn();
vi.mock('resend', () => ({
  Resend: class {
    emails = { send };
  },
}));

async function importSender() {
  return import('@/lib/email');
}

describe('sendEmail', () => {
  const payload = {
    to: 'practitioner@example.com',
    subject: 'Your trial ends in 14 days',
    html: '<p>hi</p>',
    text: 'hi',
    idempotencyKey: 'trial-warn-T-14/prac_123',
  };

  beforeEach(() => {
    vi.resetModules();
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.EMAIL_FROM = 'Natural Health Pros <agent@naturalhealthpros.com>';
    send.mockReset();
  });

  it('forwards the idempotency key as the SDK options argument', async () => {
    send.mockResolvedValue({ data: { id: 'msg_1' }, error: null });
    const { sendEmail } = await importSender();

    await sendEmail(payload);

    expect(send).toHaveBeenCalledTimes(1);
    const [body, options] = send.mock.calls[0];
    expect(options).toEqual({ idempotencyKey: 'trial-warn-T-14/prac_123' });
    expect(body.to).toBe('practitioner@example.com');
    expect(body.from).toBe('Natural Health Pros <agent@naturalhealthpros.com>');
    // Both parts, always — html-only scores worse with spam filters, and this sender's
    // deliverability was hard-won.
    expect(body.html).toBe('<p>hi</p>');
    expect(body.text).toBe('hi');
  });

  it('THROWS when the SDK resolves with an error rather than reporting success', async () => {
    send.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'Invalid `to` field' },
    });
    const { sendEmail } = await importSender();

    await expect(sendEmail(payload)).rejects.toThrow(/validation_error.*Invalid `to` field/);
  });

  it('THROWS when the SDK resolves with neither an error nor a message id', async () => {
    // A hollow success. Returning normally here would report an email as delivered that we have
    // no evidence was accepted.
    send.mockResolvedValue({ data: {}, error: null });
    const { sendEmail } = await importSender();

    await expect(sendEmail(payload)).rejects.toThrow(/no message id/i);
  });

  it('throws EmailNotConfigured when the API key is absent, distinctly from a send failure', async () => {
    delete process.env.RESEND_API_KEY;
    const { sendEmail, EmailNotConfigured } = await importSender();

    await expect(sendEmail(payload)).rejects.toBeInstanceOf(EmailNotConfigured);
    // Nothing was attempted — callers rely on this to abort a whole run instead of failing soft
    // per recipient when the run could never have succeeded.
    expect(send).not.toHaveBeenCalled();
  });

  it('does not construct a client at import time when the key is absent', async () => {
    delete process.env.RESEND_API_KEY;
    // The build imports routes that import this module; throwing on import would break it.
    await expect(importSender()).resolves.toBeDefined();
  });

  it('sanitises tag names and values Resend would reject', async () => {
    send.mockResolvedValue({ data: { id: 'msg_1' }, error: null });
    const { sendEmail } = await importSender();

    await sendEmail({
      ...payload,
      tags: [{ name: 'feature', value: 'trial sweep: T-14' }],
    });

    const [body] = send.mock.calls[0];
    expect(body.tags).toEqual([{ name: 'feature', value: 'trial-sweep--T-14' }]);
  });

  it('omits tags entirely when none are supplied', async () => {
    send.mockResolvedValue({ data: { id: 'msg_1' }, error: null });
    const { sendEmail } = await importSender();

    await sendEmail(payload);

    expect(send.mock.calls[0][0]).not.toHaveProperty('tags');
  });

  it('falls back to the sandbox sender only when EMAIL_FROM is unset', async () => {
    delete process.env.EMAIL_FROM;
    send.mockResolvedValue({ data: { id: 'msg_1' }, error: null });
    const { sendEmail } = await importSender();

    await sendEmail(payload);

    expect(send.mock.calls[0][0].from).toBe('Natural Health Pros <onboarding@resend.dev>');
  });
});
