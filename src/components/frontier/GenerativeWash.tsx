'use client';

/*
 * Class 5 — GENERATIVE.
 *
 * A computed sage/navy field used as a section texture, not a hero effect. It
 * is here rather than in the hero on purpose: the hero already carries the 3D
 * field, and stacking two ambient layers in one viewport would breach the
 * composition rule that a section has exactly one dominant element.
 *
 * The field is interference between four sine layers, sampled at a coarse grid
 * and drawn as soft cells — cheap enough to run at 30fps on a phone, and the
 * coarseness is the point: it reads as woven, not as a blurred photo.
 *
 * D4: prefers-reduced-motion → one frame at t=0, then the loop never starts.
 *     The texture is fully present, just still.
 * D7: getContext('2d') returning null → visible overlay, never a blank band.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { PipelineFailureOverlay, logPipelineFailure } from './PipelineFailure';

/*
 * Cell pitch. Small squares on a strict grid read as graph paper; soft dots on
 * a wide pitch read as a woven field, which is what a section behind legal copy
 * wants to be.
 */
const CELL = 24;

function field(x: number, y: number, t: number): number {
  return (
    Math.sin(x * 1.1 + t * 0.35) * 0.26 +
    Math.sin(y * 1.7 - t * 0.24) * 0.24 +
    Math.sin((x + y) * 0.8 + t * 0.4) * 0.2 +
    Math.sin(Math.sqrt(x * x + y * y) * 1.3 - t * 0.3) * 0.16 +
    0.5
  );
}

export function GenerativeWash({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState(false);

  const draw = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => {
    ctx.clearRect(0, 0, w, h);
    const cols = Math.ceil(w / CELL);
    const rows = Math.ceil(h / CELL);
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < cols; i += 1) {
        const nx = (i / cols) * 5 - 2.5;
        const ny = (j / rows) * 3 - 1.5;
        const v = Math.min(1, Math.max(0, field(nx, ny, t)));
        // Navy #2C4A6E -> sage #5B8A6A, held at low alpha so type stays readable.
        const r = Math.round(44 + (91 - 44) * v);
        const g = Math.round(74 + (138 - 74) * v);
        const b = Math.round(110 + (106 - 110) * v);
        // Radius carries the field value, so the texture has structure even at
        // the very low alpha the copy above it needs.
        const radius = 1.2 + v * (CELL * 0.32);
        ctx.beginPath();
        ctx.arc(i * CELL + CELL / 2, j * CELL + CELL / 2, radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${0.05 + v * 0.09})`;
        ctx.fill();
      }
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      logPipelineFailure('canvas-unavailable', 'GenerativeWash');
      setFailed(true);
      return;
    }

    let disposed = false;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(ctx, rect.width, rect.height, reduced ? 0 : performance.now() * 0.001);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    if (!reduced) {
      const loop = () => {
        if (disposed) return;
        const rect = canvas.getBoundingClientRect();
        draw(ctx, rect.width, rect.height, performance.now() * 0.001);
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [draw, reduced]);

  return (
    <div className={className}>
      {failed ? (
        <PipelineFailureOverlay kind="canvas-unavailable" component="GenerativeWash" />
      ) : (
        <canvas ref={canvasRef} aria-hidden="true" className="h-full w-full" />
      )}
    </div>
  );
}
