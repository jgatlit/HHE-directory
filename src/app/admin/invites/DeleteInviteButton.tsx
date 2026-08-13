'use client';

import { useState } from 'react';
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
 * deleted. Arming the button in place keeps the target visible under the cursor, and clicking
 * anywhere else disarms it.
 */
export function DeleteInviteButton({ id, email, action }: Props) {
  const [armed, setArmed] = useState(false);

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
    <span className="flex items-center gap-1">
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
