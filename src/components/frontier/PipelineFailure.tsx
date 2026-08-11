'use client';

/*
 * D7 — the visible failure surface.
 *
 * Every frontier component renders this instead of degrading quietly. A blank
 * rectangle where a 3D field or a video should be is the failure mode this
 * contract exists to prevent: the operator must be able to see, on the page,
 * that a pipeline stage broke.
 *
 * prefers-reduced-motion is NOT routed here. That is a user choice, not a
 * failure, and it is the only branch permitted to be silent.
 */

import { useEffect } from 'react';

export type FailureKind =
  | 'webgl-unavailable'
  | 'webgl-context-lost'
  | 'canvas-unavailable'
  | 'video-load'
  | 'video-playback';

const COPY: Record<FailureKind, { label: string; detail: string }> = {
  'webgl-unavailable': {
    label: 'Pipeline failure — WebGL unavailable',
    detail: 'The practice field could not acquire a WebGL context on this device.',
  },
  'webgl-context-lost': {
    label: 'Pipeline failure — WebGL context lost',
    detail: 'The GPU dropped the practice field context mid-render.',
  },
  'canvas-unavailable': {
    label: 'Pipeline failure — 2D canvas unavailable',
    detail: 'The generative layer could not acquire a 2D drawing context.',
  },
  'video-load': {
    label: 'Pipeline failure — video did not load',
    detail: 'The session-loop asset failed to fetch or decode.',
  },
  'video-playback': {
    label: 'Pipeline failure — video stalled',
    detail: 'Playback started and then stalled before the loop completed.',
  },
};

export function logPipelineFailure(kind: FailureKind, component: string, cause?: unknown) {
  // eslint-disable-next-line no-console
  console.error(`[frontier-UX] pipeline failure: ${kind} in <${component}>`, cause ?? '');
}

export function PipelineFailureOverlay({
  kind,
  component,
  /**
   * 'cover' fills its container — correct for a component that owns a box
   * (video, constellation). 'corner' is for a full-bleed ambient layer sitting
   * behind page copy: covering the whole hero would put the failure text
   * underneath the headline and make the report itself unreadable, which
   * defeats the purpose of reporting it.
   */
  placement = 'cover',
}: {
  kind: FailureKind;
  component: string;
  placement?: 'cover' | 'corner';
}) {
  useEffect(() => {
    logPipelineFailure(kind, component);
  }, [kind, component]);

  const { label, detail } = COPY[kind];

  if (placement === 'corner') {
    return (
      <div
        data-pipeline-failure={kind}
        data-placement="corner"
        role="status"
        aria-live="polite"
        className="pointer-events-none"
      >
        <p className="eyebrow text-rose-light">{label}</p>
        <p className="max-w-[22rem] text-sm leading-relaxed text-white/85">{detail}</p>
        <p className="font-mono text-[11px] text-white/60">
          component: {component} · kind: {kind}
        </p>
      </div>
    );
  }

  return (
    <div data-pipeline-failure={kind} role="status" aria-live="polite">
      <p className="eyebrow text-rose-light">{label}</p>
      <p className="max-w-sm text-sm leading-relaxed text-white/80">{detail}</p>
      <p className="font-mono text-[11px] text-white/50">
        component: {component} · kind: {kind}
      </p>
    </div>
  );
}
