'use client';

/*
 * Class 2 — 3D INTERACTIVE.
 *
 * The signature element, second state. Same field as the hero, now grabbable
 * and made of real data: one node per live specialty, sized by how many
 * practitioners hold it. Dragging rotates it; selecting a node runs that search.
 *
 * The accessible path is not a fallback bolted on afterwards — the index beside
 * the canvas is a real, always-present list of buttons carrying the identical
 * action. Pointer users get the field, keyboard users get the index, and both
 * drive the same selection. The canvas is aria-hidden precisely because the
 * index is authoritative.
 *
 * D4: prefers-reduced-motion → no idle rotation and no drag inertia. Every node
 *     still renders in place and every specialty is still selectable via the
 *     index, so nothing is lost.
 * D7: no WebGL, or context lost → visible overlay over the canvas half. The
 *     index keeps working, because a broken decoration must not break the tool.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { PipelineFailureOverlay, logPipelineFailure, type FailureKind } from './PipelineFailure';
import type { DirectorySpecialty } from '@/lib/directory';
import { searchUrl } from '@/lib/search-url';
import { cn } from '@/lib/utils';

function hasWebGL(): boolean {
  if (typeof document === 'undefined') return true;
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Fibonacci sphere — even distribution, no polar clustering. */
function spherePositions(n: number, radius: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i += 1) {
    const y = 1 - (i / Math.max(n - 1, 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    out.push(new THREE.Vector3(Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius));
  }
  return out;
}

function Constellation({
  specialties,
  positions,
  activeIndex,
  reduced,
  dragRef,
}: {
  specialties: DirectorySpecialty[];
  positions: THREE.Vector3[];
  activeIndex: number | null;
  reduced: boolean;
  dragRef: React.MutableRefObject<{ x: number; velocity: number }>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const maxCount = Math.max(...specialties.map((s) => s.count), 1);

  useFrame((_, delta) => {
    const g = groupRef.current;
    if (!g) return;
    if (reduced) {
      g.rotation.y = dragRef.current.x;
      return;
    }
    dragRef.current.x += dragRef.current.velocity * delta;
    dragRef.current.velocity *= 0.94;
    // Idle drift so the field never sits dead, but slower than the eye tracks.
    g.rotation.y = dragRef.current.x + performance.now() * 0.00004;
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, 0.16, 0.05);
  });

  return (
    <group ref={groupRef}>
      {positions.map((p, i) => {
        const s = specialties[i];
        const active = activeIndex === i;
        const scale = 0.1 + (s.count / maxCount) * 0.16;
        return (
          <group key={s.slug} position={p}>
            <mesh scale={active ? scale * 1.7 : scale}>
              <sphereGeometry args={[1, 20, 20]} />
              <meshBasicMaterial
                color={active ? '#C4396E' : s.parent ? '#7BA3CC' : '#A8D5B5'}
                transparent
                opacity={active ? 1 : 0.85}
              />
            </mesh>
            {active && (
              <mesh scale={scale * 3.1}>
                <sphereGeometry args={[1, 16, 16]} />
                <meshBasicMaterial color="#C4396E" transparent opacity={0.16} depthWrite={false} />
              </mesh>
            )}
          </group>
        );
      })}
      {/* Hub: the shared training every node traces back to. */}
      <mesh>
        <sphereGeometry args={[0.14, 24, 24]} />
        <meshBasicMaterial color="#EEF6F0" transparent opacity={0.55} />
      </mesh>
      <FilamentsToHub positions={positions} />
    </group>
  );
}

function FilamentsToHub({ positions }: { positions: THREE.Vector3[] }) {
  const geometry = useMemo(() => {
    const pts: number[] = [];
    positions.forEach((p) => pts.push(0, 0, 0, p.x, p.y, p.z));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [positions]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#5B8A6A" transparent opacity={0.16} depthWrite={false} />
    </lineSegments>
  );
}

function ContextGuard({ onLost }: { onLost: () => void }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      logPipelineFailure('webgl-context-lost', 'SpecialtyConstellation', e);
      onLost();
    };
    const el = gl.domElement;
    el.addEventListener('webglcontextlost', handler);
    return () => el.removeEventListener('webglcontextlost', handler);
  }, [gl, onLost]);
  return null;
}

export function SpecialtyConstellation({
  specialties,
  forceFailure,
}: {
  specialties: DirectorySpecialty[];
  /** Operator diagnostic — see the note on the same prop in SessionLoop. */
  forceFailure?: FailureKind;
}) {
  const reduced = useReducedMotion();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [failure, setFailure] = useState<FailureKind | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const dragRef = useRef({ x: 0, velocity: 0 });
  const pointer = useRef<{ down: boolean; lastX: number }>({ down: false, lastX: 0 });

  useEffect(() => {
    if (forceFailure) {
      logPipelineFailure(forceFailure, 'SpecialtyConstellation', 'forced via ?pipelineFailure');
      setFailure(forceFailure);
      setSupported(true);
      return;
    }
    const ok = hasWebGL();
    setSupported(ok);
    if (!ok) logPipelineFailure('webgl-unavailable', 'SpecialtyConstellation');
  }, [forceFailure]);

  const positions = useMemo(() => spherePositions(specialties.length, 2.55), [specialties.length]);

  const onPointerDown = (e: React.PointerEvent) => {
    pointer.current = { down: true, lastX: e.clientX };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointer.current.down) return;
    const dx = e.clientX - pointer.current.lastX;
    pointer.current.lastX = e.clientX;
    dragRef.current.x += dx * 0.006;
    dragRef.current.velocity = reduced ? 0 : dx * 0.12;
  };
  const onPointerUp = () => {
    pointer.current.down = false;
  };

  const broken = supported === false || failure !== null;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-center lg:gap-14">
      <div
        className="relative aspect-square w-full overflow-hidden rounded-2xl"
        style={{ background: 'var(--gradient-nav-bar)', boxShadow: 'var(--shadow-elevated)' }}
        data-surface="field"
      >
        {broken ? (
          <PipelineFailureOverlay
            kind={failure ?? 'webgl-unavailable'}
            component="SpecialtyConstellation"
          />
        ) : supported === null ? null : (
          <div
            className="absolute inset-0 cursor-grab active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            <Canvas
              aria-hidden="true"
              tabIndex={-1}
              camera={{ position: [0, 0, 7], fov: 45 }}
              dpr={[1, 1.75]}
              gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
            >
              <ContextGuard onLost={() => setFailure('webgl-context-lost')} />
              <Constellation
                specialties={specialties}
                positions={positions}
                activeIndex={activeIndex}
                reduced={reduced}
                dragRef={dragRef}
              />
            </Canvas>
          </div>
        )}

        <p className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 text-[11px] text-white/45">
          {broken ? 'Use the index to search' : 'Drag to turn · pick a specialty to search'}
        </p>
      </div>

      <div>
        <h3 className="eyebrow mb-1 text-muted-foreground">Specialty index</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          {specialties.length} specialties held by practitioners listed today. Counts are live.
        </p>
        <ul className="flex flex-wrap gap-1.5 lg:max-h-[26rem] lg:flex-col lg:flex-nowrap lg:overflow-y-auto lg:pr-2">
          {specialties.map((s, i) => (
            <li key={s.slug}>
              <a
                href={searchUrl({ specialtyName: s.name })}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseLeave={() => setActiveIndex(null)}
                onFocus={() => setActiveIndex(i)}
                onBlur={() => setActiveIndex(null)}
                className={cn(
                  'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors lg:w-full lg:justify-between lg:rounded-md',
                  activeIndex === i
                    ? 'border-cta/40 bg-cta/5 text-foreground'
                    : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                )}
              >
                <span>{s.name}</span>
                <span className="font-mono text-[11px] tabular-nums opacity-60">{s.count}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
