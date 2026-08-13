'use client';

import { useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ArrowUp, ArrowDown } from 'lucide-react';

type Props = {
  ids: string[];
  action: (formData: FormData) => void | Promise<void>;
};

/**
 * Offering reorder controls.
 *
 * Offerings are the odd one out among the three sortable lists. Specialties and booking links are
 * client-side arrays inside the profile form, so dragging them just rearranges an array that is
 * already about to be submitted. Each offering here is its OWN form — it has to be, because
 * update/delete/publish are per-offering server actions — and nesting a drag container across
 * sibling forms would mean either lifting every offering's fields into shared client state or
 * posting an order that contradicts unsaved edits sitting in those fields.
 *
 * So offerings get explicit move controls that post only the order, leaving every other form on
 * the page untouched. Same outcome as dragging, no risk of discarding an in-progress edit — and
 * it is keyboard-operable by construction rather than by careful sensor configuration.
 *
 * The order posts immediately on click, because there is no "save" for this list to belong to.
 */
export function OfferingOrderControls({ ids, action }: Props) {
  const [order, setOrder] = useState(ids);

  // Server state wins after a revalidate — otherwise a delete elsewhere on the page leaves this
  // holding a stale id and the next move would renumber against a list that no longer exists.
  useEffect(() => setOrder(ids), [ids]);

  if (order.length < 2) return null;

  return (
    <form action={action} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="orderJson" value={JSON.stringify(order)} />
      <span className="mr-1 text-[11px] text-muted-foreground">
        Order shown on your profile — first to last:
      </span>
      {order.map((id, i) => (
        <span key={id} className="inline-flex items-center gap-0.5">
          <MoveButton
            direction="up"
            disabled={i === 0}
            onClick={() => setOrder(swap(order, i, i - 1))}
            position={i + 1}
          />
          <span className="min-w-4 text-center text-[11px] font-medium text-muted-foreground">
            {i + 1}
          </span>
          <MoveButton
            direction="down"
            disabled={i === order.length - 1}
            onClick={() => setOrder(swap(order, i, i + 1))}
            position={i + 1}
          />
        </span>
      ))}
      <SaveOrder />
    </form>
  );
}

function swap(list: string[], a: number, b: number): string[] {
  const next = [...list];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}

function MoveButton({
  direction,
  disabled,
  onClick,
  position,
}: {
  direction: 'up' | 'down';
  disabled: boolean;
  onClick: () => void;
  position: number;
}) {
  const Icon = direction === 'up' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={`Move offering ${position} ${direction}`}
      className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
    >
      <Icon className="h-3 w-3" aria-hidden />
    </button>
  );
}

function SaveOrder() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="ml-1 inline-flex h-7 items-center rounded-md border px-2.5 text-[11px] font-medium transition-colors hover:bg-accent/40 disabled:opacity-60"
    >
      {pending ? 'Saving…' : 'Save order'}
    </button>
  );
}
