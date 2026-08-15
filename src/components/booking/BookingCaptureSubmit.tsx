'use client';

import { useFormStatus } from 'react-dom';
import { Loader2, ArrowRight } from 'lucide-react';

/**
 * The capture submit awaits several sequential database round trips before it redirects, and it
 * is the FIRST thing a buyer does — so an inert button here reads as "nothing happened" and
 * invites a second click, which is exactly the duplicate the action's dedupe window then has to
 * absorb. Cheaper to prevent the second click than to reconcile it.
 */
export function BookingCaptureSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <ArrowRight className="h-4 w-4" aria-hidden />
      )}
      {pending ? 'Saving your details…' : 'Continue'}
    </button>
  );
}
