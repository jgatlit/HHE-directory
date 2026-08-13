'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle } from 'lucide-react';

/**
 * Dirty-state guard for the profile form.
 *
 * The form is long, its only Save button sits at the very bottom, and nothing signalled that edits
 * were pending. Sarah Schindler lost an edit to exactly that on the 2026-08-11 call — and it was
 * almost certainly the City field, which is why her real account sat unlisted.
 *
 * NOT debounced autosave: against a shared production database with server-side validation that
 * buys partial writes, keystroke/submit races, and a write per field per pause, on a form somebody
 * opens a few times a year. The failure is silent LOSS, and a visible dirty state closes it.
 *
 * Three things a first revision got wrong, all of which made the guard lie:
 *
 *   1. `dirty` was never reset, so the red "Unsaved changes" bar reappeared immediately after a
 *      successful save (the action redirects to ?saved=1, a soft navigation that keeps this
 *      component mounted). A warning that shows when nothing is wrong trains people to ignore it.
 *   2. Only `beforeunload` was registered, which does NOT fire on App Router soft navigation —
 *      including the "Cancel" Link sitting directly above the Save button. The most likely way to
 *      leave this page was the one path the guard did not cover.
 *   3. Reordering never marked the form dirty. Drag-to-sort changes React state and emits no DOM
 *      input event, so the ordering feature shipped in the same release was invisible to the
 *      guard built to protect it. SortableList now dispatches a bubbling `input` event.
 */
export function UnsavedChangesBar() {
  const anchor = useRef<HTMLDivElement>(null);
  const [dirty, setDirty] = useState(false);
  const { pending } = useFormStatus();
  const wasPending = useRef(false);

  useEffect(() => {
    const form = anchor.current?.closest('form');
    if (!form) return;
    const onChange = () => setDirty(true);
    // 'input' covers typing and SortableList's synthetic reorder event; 'change' covers selects,
    // checkboxes and datalist picks, which do not reliably emit 'input'.
    form.addEventListener('input', onChange);
    form.addEventListener('change', onChange);
    return () => {
      form.removeEventListener('input', onChange);
      form.removeEventListener('change', onChange);
    };
  }, []);

  // Falling edge of `pending` = the submission completed. Whatever was dirty is now saved.
  useEffect(() => {
    if (wasPending.current && !pending) setDirty(false);
    wasPending.current = pending;
  }, [pending]);

  const active = dirty && !pending;

  // Hard navigation (tab close, reload, external link).
  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);

  // Soft navigation. Capture-phase so it runs before the router's own handler, and only for
  // in-app anchors that actually leave this page.
  useEffect(() => {
    if (!active) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const link = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      if (link.href === window.location.href) return;
      if (!window.confirm('You have unsaved changes. Leave this page and discard them?')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [active]);

  return (
    <div ref={anchor}>
      {active && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
            <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
              <span className="truncate">
                <span className="font-medium text-foreground">Unsaved changes.</span> Leaving this
                page will discard them.
              </span>
            </p>
            <button
              type="submit"
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Save profile
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
