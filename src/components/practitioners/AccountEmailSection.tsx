import { Card } from '@/components/ui/card';
import { AtSign, AlertTriangle } from 'lucide-react';

type Props = {
  /** The PROFILE OWNER's address — never the viewer's. An admin editing someone else must see theirs. */
  email: string;
  /** True when the viewer is an admin editing a profile that is not their own. */
  editingSomeoneElse: boolean;
  action: (formData: FormData) => void | Promise<void>;
  error?: 'bad-email' | 'email-taken' | null;
  saved?: boolean;
};

/**
 * Change the address that signs you in.
 *
 * Rendered with the OWNER's email, not `session.user.email`. Those differ whenever an admin is
 * editing another practitioner's profile, and showing the viewer's own address on a form that
 * writes the owner's record is how an operator changes their own login by accident — the same
 * viewer-vs-owner conflation that once told Amy every pilot she inspected was billing-exempt.
 *
 * The warning is not decoration. Magic-link is the only authentication here, so a mistyped
 * address means the owner cannot sign in at all. It is recoverable — an admin can correct it
 * from /admin/invites — and the copy says so, because a warning that only frightens is worse
 * than one that tells you the way out.
 */
export function AccountEmailSection({ email, editingSomeoneElse, action, error, saved }: Props) {
  return (
    <Card id="account" className="space-y-3 p-5">
      <div className="flex items-center gap-2">
        <AtSign className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold">Account email</h2>
      </div>

      <p className="text-xs text-muted-foreground">
        {editingSomeoneElse
          ? 'This is the address this practitioner signs in with. Changing it changes who can access this profile.'
          : 'This is the address you sign in with. We email your sign-in link and your booking notifications here.'}
      </p>

      {saved && (
        <p className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-xs">
          Email updated. Your next sign-in link will go to the new address.
        </p>
      )}

      {error && (
        <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
          <span>
            {error === 'email-taken'
              ? 'That address already belongs to another account, so nothing was changed.'
              : 'That is not a usable email address, so nothing was changed.'}
          </span>
        </p>
      )}

      <form action={action} className="flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          name="email"
          defaultValue={email}
          required
          aria-label="Account email address"
          className="h-10 flex-1 rounded-md border bg-card px-3 text-sm outline-none ring-ring/30 focus-visible:ring-2"
        />
        <button
          type="submit"
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Update email
        </button>
      </form>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Sign-in links go to this address and nowhere else, so a typo here means being locked
          out. It is fixable — an admin can restore access — but the fix is not self-serve.
          Double-check it before saving.
        </span>
      </p>
    </Card>
  );
}
