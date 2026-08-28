'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  DEFAULT_FRAMING,
  MAX_ZOOM,
  MIN_ZOOM,
  framingStyle,
  normalizeFraming,
  type PhotoFraming,
} from '@/lib/photo-framing';

type Props = {
  photoUrl: string | null;
  initial: PhotoFraming;
};

/**
 * Drag-to-pan + zoom for the profile photo.
 *
 * WHAT THIS SOLVES, measured 2026-08-28: every real photo in the library is square or wider than
 * the 4:5 hero frame — 8 of 13 are exactly square — so `object-cover` was silently cutting ~20%
 * off the sides of most portraits, always about the centre. Heads are not reliably centred, so
 * "centre" is the wrong default for a directory of headshots.
 *
 * The preview is deliberately the REAL hero frame — `aspect-[4/5]`, `object-cover`, and the exact
 * `framingStyle()` the public profile uses. Not an approximation: a framing tool whose preview
 * disagrees with the page is worse than no tool, because the practitioner would trust it and then
 * be wrong.
 *
 * ⚠️ POINTER EVENTS, NOT MOUSE EVENTS. Practitioners onboard on phones — Sarah drove onboarding
 * from her own screen on the 08-11 call — and mouse events do not fire for touch. `setPointerCapture`
 * also keeps the drag alive when the pointer leaves the small frame, which it does constantly at
 * this size.
 *
 * ⚠️ THE HIDDEN INPUTS ARE THE ONLY THING THAT PERSISTS. Dragging changes React state, which emits
 * NO form event — the same shape that made drag-reorder invisible to the unsaved-changes guard.
 * The inputs carry `form="profile-form"` because this control renders outside that form's DOM
 * subtree, and a `defaultValue`-free controlled input is what makes the guard see a change at all.
 */
export function PhotoFramingField({ photoUrl, initial }: Props) {
  const [framing, setFraming] = useState<PhotoFraming>(() => normalizeFraming(initial));
  const boxRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const mounted = useRef(false);

  /**
   * TELL THE UNSAVED-CHANGES GUARD, because nothing else will.
   *
   * Two independent reasons a reposition is invisible to it, and either alone is enough:
   *   1. Dragging changes React state. Setting a controlled input's value from state fires NO
   *      `input`/`change` DOM event — the same silence that makes drag-to-sort invisible to the
   *      guard today.
   *   2. This control renders OUTSIDE `#profile-form`'s DOM subtree. `form="profile-form"` fixes
   *      SUBMISSION only; it does not create an event path, so even a real event here would never
   *      bubble to the form's listener.
   *
   * So the event is dispatched ON the form element directly, where the listener actually sits.
   * Without this a practitioner repositions their photo, navigates away, is warned about nothing,
   * and loses the change — the exact failure the guard was built for.
   */
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    document
      .getElementById('profile-form')
      ?.dispatchEvent(new Event('input', { bubbles: true }));
  }, [framing]);

  // Pan is inverted relative to cursor movement: dragging the IMAGE left means revealing more of
  // its right side, which is a LARGER focal x. Getting this backwards feels broken instantly.
  const applyDelta = useCallback((dx: number, dy: number) => {
    const box = boxRef.current;
    if (!box) return;
    const { width, height } = box.getBoundingClientRect();
    if (!width || !height) return;
    setFraming((f) => {
      const next = {
        ...f,
        photoFocalX: f.photoFocalX - dx / width,
        photoFocalY: f.photoFocalY - dy / height,
      };
      return normalizeFraming(next);
    });
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!photoUrl) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    e.preventDefault();
    applyDelta(e.movementX, e.movementY);
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // Keyboard parity. A drag-only control is unusable without a pointer, and this one governs how
  // a practitioner is SEEN — not a decoration that can be skipped.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 24 : 6;
    const map: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const d = map[e.key];
    if (!d) return;
    e.preventDefault();
    applyDelta(d[0], d[1]);
  };

  const isDefault =
    framing.photoFocalX === DEFAULT_FRAMING.photoFocalX &&
    framing.photoFocalY === DEFAULT_FRAMING.photoFocalY &&
    framing.photoZoom === DEFAULT_FRAMING.photoZoom;

  return (
    <div className="space-y-2">
      {/* form="profile-form": this control sits OUTSIDE that form's DOM subtree. The attribute
          fixes SUBMISSION only — it does not make events bubble to the form — which is why the
          unsaved-changes guard needs the onChange below rather than relying on bubbling. */}
      <input type="hidden" form="profile-form" name="photoFocalX" value={framing.photoFocalX} />
      <input type="hidden" form="profile-form" name="photoFocalY" value={framing.photoFocalY} />
      <input type="hidden" form="profile-form" name="photoZoom" value={framing.photoZoom} />

      {photoUrl ? (
        <>
          <div className="flex items-start gap-4">
            <div
              ref={boxRef}
              role="application"
              tabIndex={0}
              aria-label="Reposition your photo — drag, or use the arrow keys"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={onKeyDown}
              className="relative aspect-[4/5] w-32 shrink-0 cursor-grab touch-none overflow-hidden rounded-xl border bg-muted ring-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoUrl}
                alt=""
                draggable={false}
                className="pointer-events-none h-full w-full select-none object-cover"
                style={framingStyle(framing)}
              />
            </div>

            <div className="min-w-0 flex-1 space-y-3">
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                This is exactly how your photo appears at the top of your profile. Drag it to
                reposition, or use the arrow keys. Nothing is cropped from the original file — you
                can change this any time.
              </p>

              <label className="block space-y-1">
                <span className="text-[11px] font-medium">Zoom</span>
                <input
                  type="range"
                  min={MIN_ZOOM}
                  max={MAX_ZOOM}
                  step={0.05}
                  value={framing.photoZoom}
                  aria-label="Zoom"
                  onChange={(e) =>
                    setFraming((f) => normalizeFraming({ ...f, photoZoom: Number(e.target.value) }))
                  }
                  className="w-full accent-primary"
                />
              </label>

              {!isDefault && (
                <button
                  type="button"
                  onClick={() => setFraming(DEFAULT_FRAMING)}
                  className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <RotateCcw className="h-3 w-3" aria-hidden />
                  Reset framing
                </button>
              )}
            </div>
          </div>
        </>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Upload a photo above to position it. Any shape works — square photos are the most common
          and crop the least.
        </p>
      )}
    </div>
  );
}
