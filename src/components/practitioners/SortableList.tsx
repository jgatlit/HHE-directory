'use client';

import type { ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';

type Orientation = 'vertical' | 'wrap';

/**
 * Shared drag-to-reorder primitive for the practitioner-controlled lists — specialties,
 * offerings and booking links.
 *
 * Requested by Sarah Schindler 2026-08-12 after finding she could arrange neither list: "It
 * doesn't allow you to arrange them from what you want the potential client to see first. It's a
 * minor issue, but it would create a better experience."
 *
 * One primitive rather than three implementations, because the lists differ in how they PERSIST,
 * not in how they should FEEL. Specialties and booking links ride along in the profile form
 * (submission order becomes sortOrder); offerings are separate rows behind their own actions and
 * need an explicit reorder call. Only onReorder differs.
 *
 * The handle is passed BACK to the caller rather than positioned here, because the layouts differ
 * too: booking links are stacked rows where a gutter grip is right, specialties are wrapping
 * chips where it has to sit inside the chip. A primitive that assumed one layout would have
 * forced the other list to reinvent it.
 *
 * KEYBOARD ACCESS IS NOT OPTIONAL. A drag-only control makes ordering unreachable for anyone not
 * using a mouse, on the form that is already the sole route to being listed at all. dnd-kit's
 * KeyboardSensor gives Space-to-lift, arrows-to-move, Space-to-drop, and the handle is a real
 * focusable button rather than a styled div.
 */
export function SortableList<T extends { id: string }>({
  items,
  onReorder,
  orientation = 'vertical',
  children,
}: {
  items: T[];
  onReorder: (next: T[]) => void;
  orientation?: Orientation;
  children: (item: T, index: number, handle: ReactNode) => ReactNode;
}) {
  const sensors = useSensors(
    // A small activation distance so a click on a button inside a row stays a click, rather than
    // a one-pixel drag that swallows it — every row here has a remove button.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((i) => i.id === active.id);
    const to = items.findIndex((i) => i.id === over.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(items, from, to));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={
        orientation === 'vertical' ? [restrictToVerticalAxis, restrictToParentElement] : undefined
      }
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={items.map((i) => i.id)}
        strategy={orientation === 'vertical' ? verticalListSortingStrategy : rectSortingStrategy}
      >
        {items.map((item, index) => (
          <SortableRow key={item.id} id={item.id} orientation={orientation}>
            {(handle) => children(item, index, handle)}
          </SortableRow>
        ))}
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({
  id,
  orientation,
  children,
}: {
  id: string;
  orientation: Orientation;
  children: (handle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const handle = (
    <button
      type="button"
      {...attributes}
      {...listeners}
      aria-label="Reorder — press space, then use the arrow keys"
      className={
        orientation === 'vertical'
          ? 'mt-1.5 shrink-0 cursor-grab rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:cursor-grabbing'
          : '-ml-1 shrink-0 cursor-grab rounded-sm p-0.5 opacity-50 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:cursor-grabbing'
      }
    >
      <GripVertical className={orientation === 'vertical' ? 'h-4 w-4' : 'h-3 w-3'} aria-hidden />
    </button>
  );

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={
        (isDragging ? 'relative z-10 opacity-90 ' : '') + (orientation === 'wrap' ? 'inline-flex' : '')
      }
    >
      {children(handle)}
    </div>
  );
}
