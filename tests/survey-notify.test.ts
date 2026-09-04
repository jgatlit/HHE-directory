import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Covers `/api/survey/notify` — the webhook a Postgres trigger on self-hosted Supabase calls
 * (via `net.http_post`) after a real practitioner-survey row lands, so Jonathan/Amy/Sarah get an
 * email per response instead of having to poll the table.
 *
 * Unlike the CRON_SECRET routes, auth here is FAIL-CLOSED: a missing secret must 500, never fall
 * through to "open" — this endpoint accepts an anonymous POST whose body is attacker-reachable
 * free text embedded into an email to real people.
 */

const mocks = vi.hoisted(() => ({ sendEmail: vi.fn() }));

vi.mock('@/lib/email', async () => {
  const actual = await vi.importActual<typeof import('@/lib/email')>('@/lib/email');
  return { ...actual, sendEmail: mocks.sendEmail };
});

const row = {
  id: 'row-123',
  created_at: '2026-09-04T12:00:00Z',
  instrument_version: '2026-09-04',
  wave: 'directory-launch',
  scheduling_tool: 'Calendly',
  booking_links_detail: 'one link for intro calls',
  no_tool_how_book: null,
  builtin_booking_value: 'would switch',
  core_offerings: '1:1 coaching',
  entry_offering: '$45 intro',
  high_ticket_offering: '$5000 program',
  client_ltv: '~$400/yr',
};

async function post(body: unknown, headers: Record<string, string> = {}) {
  const { POST } = await import('@/app/api/survey/notify/route');
  const res = await POST(
    new Request('http://localhost/api/survey/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
}

describe('survey-notify webhook', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SURVEY_WEBHOOK_SECRET = 'test-secret';
    process.env.RESEND_API_KEY = 're_test_key';
    mocks.sendEmail.mockReset();
    mocks.sendEmail.mockResolvedValue({ id: 'email-id' });
  });

  it('fails LOUD when SURVEY_WEBHOOK_SECRET is not configured — never falls through to open', async () => {
    delete process.env.SURVEY_WEBHOOK_SECRET;

    const { status, body: resBody } = await post(row, { authorization: 'Bearer anything' });

    expect(status).toBe(500);
    expect(resBody.error).toMatch(/SURVEY_WEBHOOK_SECRET/);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('rejects a missing or wrong bearer token', async () => {
    const missing = await post(row);
    expect(missing.status).toBe(401);

    const wrong = await post(row, { authorization: 'Bearer wrong-secret' });
    expect(wrong.status).toBe(401);

    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('fails LOUD when RESEND_API_KEY is missing', async () => {
    delete process.env.RESEND_API_KEY;

    const { status, body: resBody } = await post(row, { authorization: 'Bearer test-secret' });

    expect(status).toBe(500);
    expect(resBody.error).toMatch(/RESEND_API_KEY/);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('rejects malformed payloads', async () => {
    const { status } = await post({ not: 'a survey row' }, { authorization: 'Bearer test-secret' });
    expect(status).toBe(400);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('skips (200) a non-directory-launch wave without sending anything — defense in depth', async () => {
    const { status, body: resBody } = await post(
      { ...row, wave: 'watchdog' },
      { authorization: 'Bearer test-secret' },
    );
    expect(status).toBe(200);
    expect(resBody).toMatchObject({ ok: true, skipped: true });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('emails all four recipients, each with a unique per-recipient idempotency key', async () => {
    const { status, body: resBody } = await post(row, { authorization: 'Bearer test-secret' });

    expect(status).toBe(200);
    expect(resBody).toMatchObject({ ok: true, sent: 4, failures: [] });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(4);

    const recipients = mocks.sendEmail.mock.calls.map(([arg]) => arg.to);
    expect(recipients).toEqual([
      'jonathan@aichemist.agency',
      'amy@holistichealtheducators.com',
      'sarah@wild-rooted.com',
      'agent@naturalhealthpros.com',
    ]);

    const keys = mocks.sendEmail.mock.calls.map(([arg]) => arg.idempotencyKey);
    expect(new Set(keys).size).toBe(4);
    for (const key of keys) expect(key).toMatch(/^survey-notify\/row-123\//);
  });

  it('a bad send to one recipient must not abort the others, and must be counted + attributed', async () => {
    mocks.sendEmail
      .mockResolvedValueOnce({ id: 'ok-1' })
      .mockRejectedValueOnce(new Error('Resend rate_limit_exceeded'))
      .mockResolvedValueOnce({ id: 'ok-3' })
      .mockResolvedValueOnce({ id: 'ok-4' });

    const { status, body: resBody } = await post(row, { authorization: 'Bearer test-secret' });

    expect(status).toBe(200);
    expect(resBody.sent).toBe(3);
    expect(resBody.failures).toHaveLength(1);
    expect(resBody.failures[0].to).toBe('amy@holistichealtheducators.com');
    expect(resBody.failures[0].error).toMatch(/rate_limit_exceeded/);
  });

  it('returns 502 when every recipient send fails — never reports a total failure as ok', async () => {
    mocks.sendEmail.mockRejectedValue(new Error('Resend down'));

    const { status, body: resBody } = await post(row, { authorization: 'Bearer test-secret' });

    expect(status).toBe(502);
    expect(resBody.error).toMatch(/failed/i);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(4);
  });

  it('escapes user-supplied free text in the HTML body to prevent injection via the survey form', async () => {
    await post(
      { ...row, core_offerings: '<img src=x onerror=alert(1)>' },
      { authorization: 'Bearer test-secret' },
    );

    const html = mocks.sendEmail.mock.calls[0][0].html;
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
