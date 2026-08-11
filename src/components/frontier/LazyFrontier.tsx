'use client';

/*
 * three.js is ~470 kB of the bundle and neither 3D surface is needed to read
 * the page or to run a search. Loading them eagerly would put the hero's
 * headline and the search control behind a WebGL library download, which is
 * the wrong trade on a directory landing page.
 *
 * `ssr: false` cannot be used from a Server Component in Next 14, so the
 * dynamic boundary lives here, in a client module the server page can import.
 *
 * There is no loading placeholder for the practice field: it is an ambient
 * layer over a gradient that is already painted, so its absence for a few
 * hundred milliseconds reads as "not loaded yet", not as broken. The
 * constellation gets a held box at the right size so the page does not jump.
 */

import dynamic from 'next/dynamic';
import type { FailureKind } from './PipelineFailure';
import type { DirectorySpecialty } from '@/lib/directory';

const PracticeFieldImpl = dynamic(
  () => import('./PracticeField').then((m) => m.PracticeField),
  { ssr: false },
);

const SpecialtyConstellationImpl = dynamic(
  () => import('./SpecialtyConstellation').then((m) => m.SpecialtyConstellation),
  {
    ssr: false,
    loading: () => (
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-14">
        <div
          className="aspect-square w-full rounded-2xl"
          style={{ background: 'var(--gradient-nav-bar)' }}
        />
        <div />
      </div>
    ),
  },
);

export function PracticeFieldLazy(props: {
  nodeCount: number;
  groups: number[];
  forceFailure?: FailureKind;
}) {
  return <PracticeFieldImpl {...props} />;
}

export function SpecialtyConstellationLazy(props: {
  specialties: DirectorySpecialty[];
  forceFailure?: FailureKind;
}) {
  return <SpecialtyConstellationImpl {...props} />;
}
