'use client';

/*
 * three.js is ~470 kB of the bundle and the practice field is not needed to read
 * the page or to run a search. Loading them eagerly would put the hero's
 * headline and the search control behind a WebGL library download, which is
 * the wrong trade on a directory landing page.
 *
 * `ssr: false` cannot be used from a Server Component in Next 14, so the
 * dynamic boundary lives here, in a client module the server page can import.
 *
 * There is no loading placeholder for the practice field: it is an ambient
 * layer over a gradient that is already painted, so its absence for a few
 * hundred milliseconds reads as "not loaded yet", not as broken.
 *
 * Only the practice field remains here. The specialty constellation was the other three.js
 * surface; it is now SpecialtyField, which uses no WebGL, needs no dynamic boundary, and is
 * server-rendered so its specialty links are crawlable.
 */

import dynamic from 'next/dynamic';
import type { FailureKind } from './PipelineFailure';

const PracticeFieldImpl = dynamic(
  () => import('./PracticeField').then((m) => m.PracticeField),
  { ssr: false },
);

export function PracticeFieldLazy(props: {
  nodeCount: number;
  groups: number[];
  forceFailure?: FailureKind;
}) {
  return <PracticeFieldImpl {...props} />;
}
