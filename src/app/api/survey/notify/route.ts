import { NextResponse } from 'next/server';
import { sendEmail, escapeHtml } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Fired by a Postgres trigger (`nhp_survey_notify`, self-hosted Supabase, AFTER INSERT on
 * `public.nhp_practitioner_survey`) via `net.http_post` — see
 * `~/apps/Supabase/supabase/migrations/<date>_nhp_survey_notify_trigger.sql`. The respondent-facing
 * page is a static attachment on nobox-vault with no server of its own, so this route is the only
 * place that can turn a submitted row into an email.
 *
 * Auth is FAIL-CLOSED, unlike the CRON_SECRET routes: those are curled by Vercel Cron on a
 * schedule and are safe to leave open in local dev; this one accepts an anonymous POST whose body
 * is attacker-reachable free text that gets embedded in an email to real people, so a missing
 * secret must never mean "open" the way it does for cron.
 */

const RECIPIENTS = [
  'jonathan@aichemist.agency',
  'amy@holistichealtheducators.com',
  'sarah@wild-rooted.com',
  'agent@naturalhealthpros.com',
];

type SurveyRow = {
  id: string;
  created_at: string;
  instrument_version: string | null;
  wave: string;
  scheduling_tool: string | null;
  booking_links_detail: string | null;
  no_tool_how_book: string | null;
  builtin_booking_value: string | null;
  core_offerings: string | null;
  entry_offering: string | null;
  high_ticket_offering: string | null;
  client_ltv: string | null;
};

function isSurveyRow(v: unknown): v is SurveyRow {
  return !!v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string';
}

const FIELD_LABELS: [keyof SurveyRow, string][] = [
  ['scheduling_tool', 'Scheduling tool used'],
  ['booking_links_detail', 'Booking link(s) and what each is for'],
  ['no_tool_how_book', 'If no tool — how clients book today'],
  ['builtin_booking_value', 'Value of built-in scheduling'],
  ['core_offerings', 'Core offerings / most common'],
  ['entry_offering', 'Entry-level offering'],
  ['high_ticket_offering', 'High-ticket offering'],
  ['client_ltv', 'Client lifetime/annual value'],
];

function buildEmail(row: SurveyRow) {
  const or_ = (v: string | null) => v || '(not answered)';
  const subject = `New practitioner survey response — ${or_(row.scheduling_tool)}`;

  const text = [
    'PRACTITIONER PREFERENCES SURVEY — new response',
    '',
    ...FIELD_LABELS.map(([key, label]) => `${label}: ${or_(row[key] as string | null)}`),
    '',
    `Submitted: ${row.created_at}`,
    `Row id: ${row.id}`,
  ].join('\n');

  const html = `<div style="font-family: -apple-system, system-ui, sans-serif; font-size: 15px; line-height: 1.6; color: #1a1a1a;">
<p><strong>New practitioner survey response</strong></p>
<table cellpadding="4" cellspacing="0">
${FIELD_LABELS.map(
  ([key, label]) =>
    `<tr><td style="color:#666; vertical-align:top; white-space:nowrap;">${escapeHtml(label)}</td><td>${escapeHtml(or_(row[key] as string | null))}</td></tr>`,
).join('\n')}
</table>
<p style="color:#666; font-size:13px;">Submitted ${escapeHtml(row.created_at)} &middot; row ${escapeHtml(row.id)}</p>
</div>`;

  return { subject, text, html };
}

export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.SURVEY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[survey-notify] SURVEY_WEBHOOK_SECRET is not configured');
    return NextResponse.json({ error: 'SURVEY_WEBHOOK_SECRET is not configured' }, { status: 500 });
  }
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('[survey-notify] RESEND_API_KEY is not set; cannot send notifications');
    return NextResponse.json({ error: 'RESEND_API_KEY is not configured' }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!isSurveyRow(body)) {
    return NextResponse.json({ error: 'Malformed survey row payload' }, { status: 400 });
  }

  // Defense in depth — the trigger's WHEN clause already filters to directory-launch rows, but
  // this route must never fan out an email storm if that clause is ever edited or dropped.
  if (body.wave !== 'directory-launch') {
    return NextResponse.json({ ok: true, skipped: true, reason: 'non-directory-launch wave' });
  }

  const { subject, text, html } = buildEmail(body);
  const failures: { to: string; error: string }[] = [];
  let sent = 0;

  for (const to of RECIPIENTS) {
    try {
      await sendEmail({
        to,
        subject,
        text,
        html,
        idempotencyKey: `survey-notify/${body.id}/${to}`,
        tags: [{ name: 'feature', value: 'survey-notify' }],
      });
      sent += 1;
    } catch (err) {
      failures.push({ to, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (sent === 0) {
    return NextResponse.json({ error: 'All notification sends failed', failures }, { status: 502 });
  }
  return NextResponse.json({ ok: true, sent, failures });
}
