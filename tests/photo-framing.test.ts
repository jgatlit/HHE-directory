import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FRAMING,
  MAX_ZOOM,
  MIN_ZOOM,
  framingStyle,
  normalizeFraming,
} from '../src/lib/photo-framing';

/**
 * Photo framing is stored as three loose Floats with no DB-level CHECK, and every value reaches
 * the browser as CSS. That combination has one dangerous property: a bad value does not throw —
 * browsers DROP an invalid `object-position`, silently restoring the centre crop. The failure
 * therefore looks exactly like "the feature doesn't work" rather than like bad data, which is why
 * normalisation is asserted here rather than trusted.
 */
describe('normalizeFraming clamps everything that reaches CSS', () => {
  it('passes valid values through untouched', () => {
    expect(normalizeFraming({ photoFocalX: 0.25, photoFocalY: 0.75, photoZoom: 1.5 })).toEqual({
      photoFocalX: 0.25,
      photoFocalY: 0.75,
      photoZoom: 1.5,
    });
  });

  it('clamps focal points into [0,1] rather than emitting an off-canvas position', () => {
    const f = normalizeFraming({ photoFocalX: 4.2, photoFocalY: -3, photoZoom: 1 });
    expect(f.photoFocalX).toBe(1);
    expect(f.photoFocalY).toBe(0);
  });

  it('clamps zoom to its bounds', () => {
    expect(normalizeFraming({ photoZoom: 99 } as never).photoZoom).toBe(MAX_ZOOM);
    expect(normalizeFraming({ photoZoom: 0.01 } as never).photoZoom).toBe(MIN_ZOOM);
  });

  it('falls back to dead-centre for NaN/undefined/null rather than producing NaN%', () => {
    expect(normalizeFraming({ photoFocalX: NaN, photoFocalY: NaN, photoZoom: NaN })).toEqual(
      DEFAULT_FRAMING,
    );
    expect(normalizeFraming(null)).toEqual(DEFAULT_FRAMING);
    expect(normalizeFraming(undefined)).toEqual(DEFAULT_FRAMING);
  });

  it('survives a string, which is what an unparsed form field would arrive as', () => {
    expect(normalizeFraming({ photoFocalX: '0.3' } as never).photoFocalX).toBeCloseTo(0.3);
    expect(normalizeFraming({ photoFocalX: 'banana' } as never).photoFocalX).toBe(0.5);
  });
});

describe('framingStyle', () => {
  /**
   * THE BACKWARD-COMPATIBILITY GUARANTEE. Every existing row carries the defaults, so if this
   * ever stopped matching plain `object-cover`, all 13 live photos would visibly shift on deploy
   * with nobody having touched anything.
   */
  it('reproduces plain object-cover at the defaults — and emits NO transform', () => {
    const s = framingStyle(DEFAULT_FRAMING);
    expect(s.objectPosition).toBe('50.00% 50.00%');
    expect(s.transform).toBeUndefined();
  });

  it('maps the focal point to a percentage position', () => {
    const s = framingStyle({ photoFocalX: 0.25, photoFocalY: 0, photoZoom: 1 });
    expect(s.objectPosition).toBe('25.00% 0.00%');
  });

  /**
   * Zoom must magnify ABOUT THE FOCAL POINT. With a centred origin, zooming drags the subject
   * back out of frame at exactly the moment the practitioner is trying to bring it in — the
   * control would fight the user.
   */
  it('anchors the zoom origin to the focal point, not the centre', () => {
    const s = framingStyle({ photoFocalX: 0.2, photoFocalY: 0.8, photoZoom: 2 });
    expect(s.transform).toBe('scale(2)');
    expect(s.transformOrigin).toBe('20.00% 80.00%');
    expect(s.transformOrigin).toBe(s.objectPosition);
  });

  it('normalises before rendering, so a bad row still produces valid CSS', () => {
    const s = framingStyle({ photoFocalX: 99, photoFocalY: -99, photoZoom: 99 });
    expect(s.objectPosition).toBe('100.00% 0.00%');
    expect(s.transform).toBe(`scale(${MAX_ZOOM})`);
  });
});
