'use client';

import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';

type Props = {
  id: string;
  email: string;
  action: (formData: FormData) => void | Promise<void>;
};

/**
 * Two-click confirm for a destructive admin action.
 *
 * Deliberately not `window.confirm()`: a native modal blocks the whole page, is unstyleable, and
 * — in an admin list where the rows look alike — gives no indication of WHICH row is about to be
 * deleted. Arming the button in place keeps the target visible under the cursor.
 *
 * The outside-click disarm is implemented, not merely described. An earlier revision's comment
 * claimed it while no handler existed, so two rows could sit armed indefinitely — the exact
 * mis-targeting this design is meant to prevent, and the same "describes a state it doesn't
 * implement" defect this release removed from user-facing copy.
 */
export function DeleteInviteButton({ id, email, action }: Props) {
  const [armed, setArmed] = useState(false);
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!armed) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setArmed(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setArmed(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [armed]);

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        aria-label={`Delete invitation to ${email}`}
        title="Delete this invitation"
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <span ref={box} className="flex items-center gap-1">
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <button
          type="submit"
          aria-label={`Confirm deletion of the invitation to ${email}`}
          className="rounded-md bg-destructive px-2 py-1 text-[10px] font-medium text-destructive-foreground transition-opacity hover:opacity-90"
        >
          Delete
        </button>
      </form>
      <button
        type="button"
        onClick={() => setArmed(false)}
        aria-label="Cancel deletion"
        className="rounded-md px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted"
      >
        Cancel
      </button>
    </span>
  );
}
