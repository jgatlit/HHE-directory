/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Practitioner headshots live in the public Vercel Blob store; the landing
    // page's directory rail runs them through next/image.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.public.blob.vercel-storage.com',
      },
    ],
  },

  /**
   * CONTENT SECURITY POLICY.
   *
   * The reason this exists: `SchedulerFrame.loadScript()` injects Calendly's and cal.com's
   * widget scripts into OUR document — not into the iframe. They run with our origin's
   * privileges on `/practitioners/[slug]/book/[token]`, a page holding the booking token (an
   * unauthenticated bearer credential §10 emails to buyers) and the buyer's typed name and email.
   *
   * Before this, nothing constrained them and there was no `integrity` attribute — a
   * trust-the-CDN position revocable by either vendor without any change on our side. A security
   * review rated this ABOVE the iframe sandbox question it had been asked to look at.
   *
   * ⚠️ `script-src` deliberately keeps 'unsafe-inline' and 'unsafe-eval'. Next.js's App Router
   * ships inline bootstrap/flight scripts, and removing them needs per-request nonces via
   * middleware. Doing that here would break every page for a policy that is not yet the binding
   * constraint. The value delivered today is the HOST ALLOWLIST: a compromised third party can no
   * longer be swapped for an arbitrary origin, and `connect-src` bounds where anything can
   * exfiltrate TO. Nonces are the correct follow-up, not a blocker.
   *
   * `frame-src` lists the scheduler and checkout hosts. Adding a provider means adding it here
   * too — the adapter table in scheduler-adapters.ts and this list must stay in step, or the
   * embed silently fails to frame.
   */
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://assets.calendly.com https://app.cal.com https://embed.acuityscheduling.com https://js.whop.com https://*.whop.com https://www.google.com https://www.gstatic.com",
      "style-src 'self' 'unsafe-inline' https://assets.calendly.com https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      // Where anything on the page may send data. This is the exfiltration bound.
      "connect-src 'self' https://*.calendly.com https://*.cal.com https://*.acuityscheduling.com https://*.squarespace.com https://*.whop.com https://*.typesense.net https://*.upstash.io https://*.ingest.sentry.io",
      // Practitioner schedulers + Whop checkout. Keep in step with scheduler-adapters.ts.
      "frame-src 'self' https://*.calendly.com https://*.cal.com https://*.acuityscheduling.com https://*.as.me https://*.savvycal.com https://*.whop.com https://www.google.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; ');

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          // Belt-and-braces on the booking token. The browser default is already
          // strict-origin-when-cross-origin, but stating it means a future default change cannot
          // start sending the token-bearing URL to a practitioner's scheduler.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
