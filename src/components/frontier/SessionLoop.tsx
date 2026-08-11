'use client';

/*
 * Class 7 — VIDEO.
 *
 * A 12s silent loop, generated procedurally from the brand tokens by
 * scripts/build-media.sh and self-hosted. It is not stock footage of a clinic:
 * this directory has no clinics, and a wellness stock loop would be the exact
 * templated move the brief rules out. The clip is a breath — 6s period, matched
 * to the practice field's pulse — so the two moving layers on the page agree.
 *
 * D4: prefers-reduced-motion → the poster frame renders instead, at full size,
 *     with the same caption. Nothing is hidden; the loop simply does not run.
 * D7: a load error, a decode error, or a stall after play → visible overlay +
 *     [frontier-UX] console error. There is no silent poster-instead-of-video
 *     path; that is the failure mode this contract names explicitly.
 */

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { PipelineFailureOverlay, logPipelineFailure, type FailureKind } from './PipelineFailure';

const SRC = '/media/practice-loop.mp4';
const POSTER = '/media/practice-loop-poster.jpg';
/** Playback must progress within this window after play() resolves, or it stalled. */
const STALL_MS = 4000;

export function SessionLoop({ forceFailure }: { forceFailure?: FailureKind }) {
  const reduced = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failure, setFailure] = useState<FailureKind | null>(null);

  // D7 verification hook: ?pipelineFailure=video-load forces the real overlay
  // path so the contract can be exercised without breaking the asset.
  useEffect(() => {
    if (forceFailure) {
      logPipelineFailure(forceFailure, 'SessionLoop', 'forced via ?pipelineFailure');
      setFailure(forceFailure);
    }
  }, [forceFailure]);

  useEffect(() => {
    if (reduced || forceFailure) return;
    const video = videoRef.current;
    if (!video) return;

    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    let lastTime = 0;

    const armStallCheck = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        if (video.currentTime === lastTime && !video.paused) {
          logPipelineFailure('video-playback', 'SessionLoop', `stalled at ${video.currentTime}s`);
          setFailure('video-playback');
        }
      }, STALL_MS);
      lastTime = video.currentTime;
    };

    const onError = () => {
      logPipelineFailure('video-load', 'SessionLoop', video.error);
      setFailure('video-load');
    };
    const onStalled = () => {
      logPipelineFailure('video-playback', 'SessionLoop', 'stalled event');
      setFailure('video-playback');
    };
    const onTimeUpdate = () => armStallCheck();

    video.addEventListener('error', onError);
    video.addEventListener('stalled', onStalled);
    video.addEventListener('timeupdate', onTimeUpdate);

    video.play().catch((err) => {
      // Autoplay refusal is not a pipeline failure — the clip is muted and
      // inline, so a refusal here means the user or the platform chose not to
      // play it. Log it, leave the poster showing, do not raise the overlay.
      // eslint-disable-next-line no-console
      console.warn('[frontier-UX] SessionLoop autoplay declined by the browser', err);
    });

    return () => {
      clearTimeout(stallTimer);
      video.removeEventListener('error', onError);
      video.removeEventListener('stalled', onStalled);
      video.removeEventListener('timeupdate', onTimeUpdate);
    };
  }, [reduced, forceFailure]);

  return (
    <figure className="relative m-0 overflow-hidden rounded-2xl" data-surface="field">
      <div className="relative aspect-[16/9] w-full bg-[var(--field-deep)]">
        {failure ? (
          <PipelineFailureOverlay kind={failure} component="SessionLoop" />
        ) : reduced ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={POSTER}
            alt="A slow navy-to-sage light, breathing outward and back — the still frame of the session loop."
            className="h-full w-full object-cover"
          />
        ) : (
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            src={SRC}
            poster={POSTER}
            muted
            loop
            playsInline
            preload="metadata"
            aria-label="Ambient loop: a slow navy-to-sage light breathing outward and back."
          />
        )}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'linear-gradient(180deg, rgba(20,36,58,0) 45%, rgba(20,36,58,0.82) 100%)' }}
        />
        <figcaption className="absolute inset-x-0 bottom-0 p-6 sm:p-8">
          <p className="eyebrow text-rose-light/80">A session, not an appointment</p>
          <p className="mt-2 max-w-md font-serif text-xl leading-snug text-white sm:text-2xl">
            Most of this directory works over video. You book a time, you show up where you already
            are.
          </p>
        </figcaption>
      </div>
    </figure>
  );
}
