import { ImageResponse } from 'next/og';
import { getDirectory } from '@/lib/directory';

/*
 * The social card. Rendered at request time from the brand tokens and the live
 * counts, so a shared link carries a real number rather than a stock photo.
 * Production has no OG image at all today — links render bare.
 */

export const runtime = 'nodejs';
// Same reason as the home page: the counts below are live directory state, and a
// card baked at build time would quote a number that has since moved.
export const dynamic = 'force-dynamic';
export const alt = 'Natural Health Pros — the natural health professional directory';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpengraphImage() {
  const { facts } = await getDirectory();

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          background: 'linear-gradient(135deg, #1A2F4A 0%, #2C4A6E 100%)',
          color: '#ffffff',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <svg width="44" height="44" viewBox="0 0 40 40" fill="none">
            <path d="M20 31 L9 14" stroke="rgba(255,255,255,0.85)" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M20 31 L20 8" stroke="rgba(255,255,255,0.85)" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M20 31 L31 14" stroke="rgba(255,255,255,0.85)" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M6 17 Q20 3 34 17" stroke="rgba(255,255,255,0.45)" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="9" cy="14" r="2.6" fill="#F2D0DE" />
            <circle cx="20" cy="8" r="2.6" fill="#F2D0DE" />
            <circle cx="31" cy="14" r="2.6" fill="#F2D0DE" />
            <circle cx="20" cy="31" r="3.4" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="1.6" />
          </svg>
          <span style={{ fontSize: 30, letterSpacing: -0.5 }}>Natural Health Pros</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ fontSize: 68, lineHeight: 1.08, letterSpacing: -1.6, maxWidth: 940 }}>
            Natural Health Professional Directory
          </div>
          <div style={{ fontSize: 30, color: 'rgba(255,255,255,0.72)', maxWidth: 820 }}>
            Affordable, life-changing holistic health services at your fingertips
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 28, fontSize: 22 }}>
          <span style={{ color: 'rgba(255,255,255,0.6)' }}>
            {facts.practitionerCount} trained practitioners
          </span>
          <span style={{ color: 'rgba(255,255,255,0.3)' }}>·</span>
          <span style={{ color: 'rgba(255,255,255,0.6)' }}>
            {facts.specialtyCount} specialties
          </span>
          <span style={{ color: 'rgba(255,255,255,0.3)' }}>·</span>
          <span style={{ color: '#F2D0DE' }}>naturalhealthpros.com</span>
        </div>
      </div>
    ),
    size,
  );
}
