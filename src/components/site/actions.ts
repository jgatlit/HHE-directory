'use server';

import { signOut } from '@/auth';

/**
 * The header's sign-out.
 *
 * A server action rather than `next-auth/react`'s client `signOut()` because this app has no
 * SessionProvider anywhere — SiteHeader takes its identity as props for exactly that reason
 * (see the note on its Props) — and mounting one around the whole tree to end a session would
 * be the machinery that decision exists to avoid. A <form action={...}> needs neither.
 *
 * `redirectTo` is the homepage rather than the current path: sign-out is reachable from the
 * header, the header renders on the homepage, and every gated route would bounce a
 * just-signed-out user to /auth/signin anyway.
 */
export async function signOutAction() {
  await signOut({ redirectTo: '/' });
}
