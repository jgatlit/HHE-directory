import { randomBytes } from 'node:crypto';

/** Shared token minter for link-based flows (invitations, email-change confirmation). One
 *  implementation so entropy/encoding changes apply everywhere at once. */
export function newToken(): string {
  return randomBytes(24).toString('base64url');
}
