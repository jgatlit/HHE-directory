'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  /** Hidden inputs submitted with the action. */
  fields: Record<string, string>;
  icon: ReactNode;
  idleLabel: string;
  idleTitle: string;
  confirmText: string;
  confirmLabel: string;
  tone?: 'destructive' | 'primary';
};

/**
 * Two-click confirm for an admin action, extracted from DeleteInviteButton so the archive control
 * shares the SAME arm/disarm logic rather than a copy of it.
 *
 * That sharing is the point. The outside-click disarm here is subtle enough that an earlier
 * revision of DeleteInviteButton described it in a comment while implementing nothing, leaving two
 * rows armed at once — the exact mis-targeting the design exists to prevent. Duplicating thirty
 * lines of it into a second component is how that defect comes back.
 *
 * Deliberately not `window.confirm()`: a native modal blocks the page, is unstyleable, and in a
 * list of near-identical rows gives no indication of WHICH row is about to be acted on. Arming in
 * place keeps the target visible under the cursor.
 */
export function ConfirmActionButton({
  action,
  fields,
  icon,
  idleLabel,
  idleTitle,
  confirmText,
  confirmLabel,
  tone = 'destructive',
}: Props) {
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
        aria-label={idleLabel}
        title={idleTitle}
        className={
          tone === 'destructive'
            ? 'rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive'
            : 'rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary'
        }
      >
        {icon}
      </button>
    );
  }

  return (
    <span ref={box} className="flex items-center gap-1">
      <form action={action}>
        {Object.entries(fields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <button
          type="submit"
          aria-label={confirmLabel}
          className={
            tone === 'destructive'
              ? 'rounded-md bg-destructive px-2 py-1 text-[10px] font-medium text-destructive-foreground transition-opacity hover:opacity-90'
              : 'rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground transition-opacity hover:opacity-90'
          }
        >
          {confirmText}
        </button>
      </form>
      <button
        type="button"
        onClick={() => setArmed(false)}
        aria-label="Cancel"
        className="rounded-md px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted"
      >
        Cancel
      </button>
    </span>
  );
}
