import type { NextAuthConfig } from 'next-auth';
import Resend from 'next-auth/providers/resend';
import type { Role } from '@prisma/client';

// Edge-safe base auth config — NO Prisma adapter, NO database access.
// `middleware.ts` builds a NextAuth instance from THIS config only, so the Edge bundle
// stays well under Vercel's 1 MB limit (the Prisma client + adapter would blow it — that
// failure is why the dual-label schema growth tipped the old single-file config over).
// The full `auth.ts` composes this with the adapter + db-touching jwt callback/events.
//
// `import type { Role }` is erased at compile time — no runtime Prisma dependency here.
export const authConfig = {
  session: {
    strategy: 'jwt',
    /**
     * ~13 months. Effectively "does not expire", per operator direction 2026-08-18: simplicity
     * and low friction for a non-technical cohort whose ONLY way back in is a magic-link email.
     * Every expiry is a round trip through their inbox, and this cohort is the one least likely
     * to complete it.
     *
     * ⚠️ This is only safe because the role is no longer cached in the token. src/auth.ts's `jwt`
     * callback re-reads it from the database on every request, so a long session no longer means
     * a long-lived stale permission. **Do not shorten this to bound a role-staleness window, and
     * do not re-introduce role caching to save the lookup** — those are the same mistake from
     * opposite directions, and together they are what made a 30-day stale-admin window the only
     * available trade.
     *
     * Residual, accepted: with no `Session` rows (JWT strategy) there is no server-side
     * revocation, so a STOLEN token cannot be invalidated. Previously the 30-day default closed
     * that window eventually; now it does not. If that ever needs solving, add a `tokenVersion`
     * claim compared against the database — the same read the jwt callback already performs.
     */
    maxAge: 60 * 60 * 24 * 400,
  },
  pages: {
    signIn: '/auth/signin',
    verifyRequest: '/auth/verify-request',
    error: '/auth/error',
  },
  providers: [
    Resend({
      apiKey: process.env.RESEND_API_KEY ?? '',
      from: process.env.EMAIL_FROM ?? 'Natural Health Pros <onboarding@resend.dev>',
    }),
  ],
  callbacks: {
    // Pure: reads role off the signed JWT. Safe in the Edge runtime — no db. Lets middleware see
    // session.user.role.
    //
    // ⚠️ In the FULL instance (src/auth.ts) that value was refreshed from the database by the jwt
    // callback moments earlier, so it is current. In MIDDLEWARE it is whatever the cookie holds,
    // because middleware builds from this config alone and has no adapter — so treat middleware's
    // view of the role as a hint for redirecting, never as the authorisation decision.
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.role = (token.role ?? 'CLIENT') as Role;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
