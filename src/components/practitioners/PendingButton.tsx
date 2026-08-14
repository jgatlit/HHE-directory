'use client';

import { useFormStatus } from 'react-dom';
import { Loader2 } from 'lucide-react';

/**
 * Submit button that reports its own in-flight state.
 *
 * Every caller awaits a real Whop network round trip — createConnectedAccount, createAccountLink,
 * createOfferingCheckout, createSubscriptionCheckout — before it redirects. Without this the
 * button sits inert for several seconds and then the page changes underneath the practitioner,
 * which reads as "nothing happened" and invites a second click on a non-idempotent action.
 *
 * ⚠️ `intent` exists because `useFormStatus()` reports the enclosing FORM, not the button. The
 * offerings row is a single `<form action={updateAction}>` whose Remove / Publish / Unpublish
 * buttons override it with `formAction`, so a naive `pending` lights EVERY button in the row at
 * once. A submit button's own name/value pair is included in the payload only when that button
 * is the one that submitted — so matching on it identifies the actual click. Pass `intent` for
 * any button sharing a form with another; omit it when the button is alone in its form.
 */
export function PendingButton({
  children,
  pendingLabel,
  className,
  intent,
  formAction,
  formNoValidate,
  ariaLabel,
  icon,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  className?: string;
  /** Required when this button shares a <form> with other submit buttons. */
  intent?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
  formNoValidate?: boolean;
  ariaLabel?: string;
  icon?: React.ReactNode;
}) {
  const { pending, data } = useFormStatus();
  // If `data` is unavailable we cannot tell which button submitted, so fall back to the form's
  // own pending state rather than resolving to false. Being briefly over-eager (every button in
  // the row spins) is a visible, self-correcting wrong; resolving to false would silently show
  // no feedback at all, which is the exact defect this component exists to remove.
  const isMine = pending && (intent === undefined || !data || data.get('intent') === intent);

  return (
    <button
      type="submit"
      // Disable on ANY submit of this form, not just our own: a second action fired while the
      // first is in flight is exactly the double-submit this component exists to prevent.
      disabled={pending}
      aria-label={ariaLabel}
      aria-busy={isMine}
      {...(intent !== undefined ? { name: 'intent', value: intent } : {})}
      {...(formAction ? { formAction } : {})}
      {...(formNoValidate ? { formNoValidate: true } : {})}
      className={className}
    >
      {isMine ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : icon}
      {isMine ? pendingLabel : children}
    </button>
  );
}
