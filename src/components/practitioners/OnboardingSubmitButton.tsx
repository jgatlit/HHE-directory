'use client';

import { useFormStatus } from 'react-dom';
import { Sparkles, Loader2 } from 'lucide-react';

/**
 * submitOnboarding awaits draftProfile() (an LLM call) before it ever redirects, so a plain
 * submit button gives no feedback for several seconds and then the page just changes underneath
 * the practitioner — their first impression of the product. useFormStatus only reports the
 * state of its own enclosing <form>, so this has to be its own client component rather than
 * folding the pending state into OnboardingForm itself (which can stay a server component).
 */
export function OnboardingSubmitButton({ isPrefilled }: { isPrefilled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <Sparkles className="h-4 w-4" aria-hidden />
      )}
      {pending ? 'Generating your page…' : isPrefilled ? 'Regenerate my page' : 'Generate my page'}
    </button>
  );
}
