'use client';

import { useEffect, useRef, useState } from 'react';
import { PencilLine } from 'lucide-react';

type Props = {
  id: string;
  email: string;
  action: (formData: FormData) => void | Promise<void>;
};

/**
 * Correct the registered email on an invitation + its practitioner.
 *
 * Click-to-reveal rather than an always-present input, for the same reason DeleteInviteButton
 * arms in place: in a list of near-identical rows, an editable field on every row invites edits
 * to the wrong one. The input is seeded with the current address and selected on open, so the
 * common case (fixing a typo) is one click and one retype.
 *
 * Outside-click and Escape close WITHOUT submitting — abandoning an edit must never write.
 */
export function EditEmailControl({ id, email, action }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    // Explicit focus() before select() is DEFENSIVE, not a fix. `select()` already focuses the
    // element in Chromium — measured directly 2026-08-18, and typing replaced the value with or
    // without this line — but the HTML spec defines select() as setting the selection range, not
    // as focusing, so leaning on the side effect is leaning on an implementation detail.
    //
    // ⚠️ A previous revision of this comment claimed select-on-open was BROKEN and that focus()
    // repaired it. That was wrong. The evidence was a reading of selectionStart/selectionEnd,
    // which are `null` on <input type="email"> because the selection API does not apply to that
    // type — so the "selection length 0" it reported was an artefact of measuring a property
    // that cannot have a value here, not a defect in this component.
    input.current?.focus();
    input.current?.select();
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Change the registered email address for ${email}`}
        title="Change registered email — updates the invitation and the account together"
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
      >
        <PencilLine className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <span ref={box} className="flex items-center gap-1">
      <form action={action} className="flex items-center gap-1">
        <input type="hidden" name="id" value={id} />
        <input
          ref={input}
          type="email"
          name="email"
          defaultValue={email}
          required
          aria-label="New email address"
          className="h-8 w-56 rounded-md border bg-card px-2 text-xs outline-none ring-ring/30 focus-visible:ring-2"
        />
        <button
          type="submit"
          className="rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Save
        </button>
      </form>
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Cancel email change"
        className="rounded-md px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted"
      >
        Cancel
      </button>
    </span>
  );
}
