'use client';

/*
 * Class 1 — 3D AMBIENT.
 *
 * The signature element, first state. Every listed practitioner is a node in a
 * shallow disc; filaments connect nodes that share a specialty. It is the
 * directory's actual join table rendered as weather — the field is generated
 * from the real fixture, so it thickens as the directory grows.
 *
 * Tonally this is the restraint budget for the whole page: slow, low-contrast,
 * navy and sage only. Rose never appears here — --cta belongs to the booking
 * action and decoration would spend it.
 *
 * D4: prefers-reduced-motion → frameloop 'never'. The scene still renders one
 *     full frame, so the composition is complete and nothing is missing; it
 *     simply does not move. Canvas is aria-hidden and non-focusable, so the
 *     keyboard path through the hero is unaffected either way.
 * D7: no WebGL context, or a context lost mid-flight → visible overlay +
 *     [frontier-UX] console error. Never a blank navy rectangle.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { PipelineFailureOverlay, logPipelineFailure, type FailureKind } from './PipelineFailure';

export type FieldNode = {
  /** Shared-specialty adjacency, used to decide which nodes get a filament. */
  group: number;
};

function hasWebGL(): boolean {
  if (typeof document === 'undefined') return true;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      canvas.getContext('webgl2') ||
        canvas.getContext('webgl') ||
        canvas.getContext('experimental-webgl'),
    );
  } catch {
    return false;
  }
}

/** Deterministic PRNG so server and client agree and the field never reflows. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A soft round dot, drawn once. Without it every point renders as a square. */
function useSpriteTexture(): THREE.Texture | null {
  return useMemo(() => {
    if (typeof document === 'undefined') return null;
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    // No overlay here: this texture is decorative detail inside a component
    // that already renders a visible failure state if the GL context is gone.
    // A missing 2D context downgrades the dot to a square, which is a cosmetic
    // difference, not a missing pipeline stage.
    if (!ctx) return null;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, []);
}

function Field({ nodes, reduced }: { nodes: FieldNode[]; reduced: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const sprite = useSpriteTexture();

  const { pointGeometry, lineGeometry, dustGeometry } = useMemo(() => {
    const rand = mulberry32(0x4a6e2c);
    const count = Math.max(nodes.length, 12);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const navy = new THREE.Color('#9DC2E6');
    const sage = new THREE.Color('#BCE3C6');

    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < count; i += 1) {
      // Golden-angle spiral keeps the disc even without clumping.
      const t = (i + 0.5) / count;
      const radius = 3.6 * Math.sqrt(t) + rand() * 0.35;
      const angle = i * 2.39996;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = (rand() - 0.5) * 1.1;
      positions.set([x, y, z], i * 3);
      pts.push(new THREE.Vector3(x, y, z));

      // Practitioners holding more specialties sit warmer toward sage, so the
      // field's colour still carries the data even though every point is one
      // size. A per-point size attribute would need a custom shader for the
      // gain it buys at this scale.
      const weight = Math.min((nodes[i]?.group ?? 1) / 7, 1);
      const c = navy.clone().lerp(sage, 0.15 + weight * 0.6);
      colors.set([c.r, c.g, c.b], i * 3);
    }

    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // A far, dim dust layer. It carries no meaning — it is depth, so the
    // thirteen bright nodes read as near rather than as a sparse scatter.
    const DUST = 260;
    const dust = new Float32Array(DUST * 3);
    for (let i = 0; i < DUST; i += 1) {
      const r = 5 + rand() * 7;
      const a = rand() * Math.PI * 2;
      dust.set([Math.cos(a) * r, (rand() - 0.5) * 5.5, Math.sin(a) * r - 2], i * 3);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dust, 3));

    // Filaments: nearest-neighbour pairs, capped so the field stays airy.
    const segs: number[] = [];
    for (let i = 0; i < pts.length; i += 1) {
      let best = -1;
      let bestD = Infinity;
      for (let j = 0; j < pts.length; j += 1) {
        if (i === j) continue;
        const d = pts[i].distanceToSquared(pts[j]);
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      if (best >= 0 && bestD < 2.4) {
        segs.push(pts[i].x, pts[i].y, pts[i].z, pts[best].x, pts[best].y, pts[best].z);
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));

    return { pointGeometry: pg, lineGeometry: lg, dustGeometry: dg };
  }, [nodes]);

  useEffect(() => {
    return () => {
      pointGeometry.dispose();
      lineGeometry.dispose();
      dustGeometry.dispose();
    };
  }, [pointGeometry, lineGeometry, dustGeometry]);

  useFrame((state) => {
    if (reduced || !groupRef.current) return;
    const t = state.clock.elapsedTime;
    groupRef.current.rotation.y = t * 0.035;
    // Breath: the same 6s period as the video loop, so the two ambient layers
    // on the page share a pulse instead of beating against each other.
    groupRef.current.position.y = Math.sin((t / 6) * Math.PI * 2) * 0.12;
  });

  return (
    <group ref={groupRef} rotation={[0.42, 0, 0]}>
      {/* Depth layer, far back and dim. */}
      <points geometry={dustGeometry}>
        <pointsMaterial
          size={0.07}
          sizeAttenuation
          color="#7BA3CC"
          transparent
          opacity={0.3}
          depthWrite={false}
          map={sprite}
          alphaMap={sprite}
          blending={THREE.AdditiveBlending}
        />
      </points>

      {/* One point of light per listed practitioner. Additive blending against
          the navy ground is what makes these read as lit rather than as flat
          discs; the sprite keeps them round instead of square. */}
      <points geometry={pointGeometry}>
        <pointsMaterial
          size={0.28}
          sizeAttenuation
          vertexColors
          transparent
          opacity={1}
          depthWrite={false}
          map={sprite}
          alphaMap={sprite}
          blending={THREE.AdditiveBlending}
        />
      </points>

      <lineSegments geometry={lineGeometry}>
        <lineBasicMaterial color="#8FC5A0" transparent opacity={0.5} depthWrite={false} />
      </lineSegments>
    </group>
  );
}

/** Renders exactly one frame when motion is off, then stops. */
function DemandFrame({ reduced }: { reduced: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (reduced) invalidate();
  }, [reduced, invalidate]);
  return null;
}

export function PracticeField({
  nodeCount,
  groups,
  forceFailure,
}: {
  nodeCount: number;
  groups: number[];
  /** Operator diagnostic — see the note on the same prop in SessionLoop. */
  forceFailure?: FailureKind;
}) {
  const reduced = useReducedMotion();
  const [failure, setFailure] = useState<FailureKind | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    if (forceFailure) {
      logPipelineFailure(forceFailure, 'PracticeField', 'forced via ?pipelineFailure');
      setFailure(forceFailure);
      setSupported(true);
      return;
    }
    const ok = hasWebGL();
    setSupported(ok);
    if (!ok) logPipelineFailure('webgl-unavailable', 'PracticeField');
  }, [forceFailure]);

  const nodes = useMemo<FieldNode[]>(
    () => Array.from({ length: nodeCount }, (_, i) => ({ group: groups[i] ?? 0 })),
    [nodeCount, groups],
  );

  if (supported === false || failure) {
    return (
      <div className="relative h-full w-full">
        <PipelineFailureOverlay
          kind={failure ?? 'webgl-unavailable'}
          component="PracticeField"
          placement="corner"
        />
      </div>
    );
  }

  // Pre-detection: nothing painted yet. The parent already carries the navy
  // gradient, so this is a held frame, not a degraded state.
  if (supported === null) return null;

  return (
    <Canvas
      aria-hidden="true"
      tabIndex={-1}
      className="!absolute inset-0"
      camera={{ position: [0, 1.6, 7.2], fov: 46 }}
      dpr={[1, 1.75]}
      frameloop={reduced ? 'demand' : 'always'}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
      onCreated={({ gl }) => {
        const onLost = (e: Event) => {
          e.preventDefault();
          logPipelineFailure('webgl-context-lost', 'PracticeField', e);
          setFailure('webgl-context-lost');
        };
        gl.domElement.addEventListener('webglcontextlost', onLost);
      }}
    >
      <DemandFrame reduced={reduced} />
      <Field nodes={nodes} reduced={reduced} />
    </Canvas>
  );
}
