'use client';

import { useEffect, useState } from 'react';

/**
 * D4 — single source of truth for motion gating.
 *
 * Starts `true` and drops to the real value after mount. Erring toward "no
 * motion" on the first paint means the static, fully-rendered state is what
 * server HTML and the pre-hydration frame agree on; a user who prefers reduced
 * motion never sees a flash of animation before the query resolves.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  return reduced;
}
