'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle } from 'lucide-react';

/**
 * Dirty-state guard for the profile form.
 *
 * The form is long, its only Save button sits at the very bottom, and nothing signalled that
 * edits were pending. Sarah Schindler lost an edit to exactly that on the 2026-08-11 call —
 * Jonathan, watching it happen: "That should not require you to save, but it does right now.
 * So that's a good feedback. Anything in that card right now wants you to save it."
 *
 * That is not a cosmetic loss. The field most likely to be edited-and-abandoned is City, and a
 * missing city fails isProfileComplete() -> isListed(), so a dropped save leaves the practitioner
 * invisible in the directory with no error anywhere. It already happened to the one practitioner
 * it could least afford to happen to.
 *
 * NOT debounced autosave, deliberately. Autosave on a form with server-side validation and a
 * shared production database means partial writes, races between keystroke and submit, and a
 * write per field per pause — for a form somebody opens a few times a year. A visible dirty
 * state plus a reachable Save closes the actual failure (silent loss) without any of that.
 */
export function UnsavedChangesBar() {
  const anchor = useRef<HTMLDivElement>(null);
  const [dirty, setDirty] = useState(false);
  const { pending } = useFormStatus();

  useEffect(() => {
    const form = anchor.current?.closest('form');
    if (!form) return;
    const onChange = () => setDirty(true);
    // 'input' covers typing; 'change' covers selects, checkboxes and datalist picks, which
    // never emit 'input' in some browsers — the city field is exactly that shape.
    form.addEventListener('input', onChange);
    form.addEventListener('change', onChange);
    return () => {
      form.removeEventListener('input', onChange);
      form.removeEventListener('change', onChange);
    };
  }, []);

  useEffect(() => {
    if (!dirty || pending) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, pending]);

  return (
    <div ref={anchor}>
      {dirty && !pending && (
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
