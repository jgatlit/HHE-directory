/**
 * Throwaway seed for LOCAL browser verification of PR #97 (vault tsk_5e48d722).
 *
 * ⚠️ LOCAL ONLY. It refuses to run against anything but localhost — this repo's `.env` points at
 * the shared Neon database, and a seed that guessed wrong would write test practitioners into it.
 *
 * Covers the cases the six pending acceptance criteria actually need:
 *   acuity-case   — Acuity link (prefill is URL params, assertable from the iframe src) + three
 *                   listed offerings with price and duration + qualifications
 *   calendly-case — Calendly link (prefill goes over postMessage, not the URL)
 *   null-case     — unknown scheduler host, so the null adapter runs with no prefill at all
 *   consult-case  — §3 SHAPE A: a bare Booking Link with ZERO offerings, the typical free consult
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.hhe_directory_DATABASE_URL ?? '';
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error(`REFUSING TO RUN — datasource is not local: ${url.replace(/:[^:@]*@/, ':***@')}`);
  process.exit(1);
}

const prisma = new PrismaClient();

async function make(opts: {
  slug: string;
  name: string;
  linkUrl: string | null;
  linkLabel?: string | null;
  offerings?: { title: string; cents: number; duration: number | null; description: string }[];
  qualifications?: string[];
}) {
  const user = await prisma.user.create({
    data: { email: `${opts.slug}@example.test`, role: 'PRACTITIONER' },
  });
  const p = await prisma.practitioner.create({
    data: {
      userId: user.id,
      slug: opts.slug,
      displayName: opts.name,
      headline: 'Holistic Health Practitioner',
      whoIHelp: 'I help people with fatigue, stress and gut issues find a sustainable footing.',
      bio: 'First paragraph about my practice and how I got here.\n\nSecond paragraph, so the profile has real multi-paragraph copy to render.',
      qualifications: opts.qualifications ?? [],
    },
  });

  let linkId: string | null = null;
  if (opts.linkUrl) {
    const link = await prisma.bookingLink.create({
      data: {
        practitionerId: p.id,
        url: opts.linkUrl,
        label: opts.linkLabel ?? null,
        // Deliberately left at the DEFAULT 'OTHER' for every row — mirroring the live stale row,
        // and proving dispatch derives the provider from the URL rather than reading this (D16).
      },
    });
    linkId = link.id;
    await prisma.practitioner.update({
      where: { id: p.id },
      data: { primaryBookingLinkId: link.id },
    });
  }

  const list = opts.offerings ?? [];
  for (let i = 0; i < list.length; i++) {
    const o = list[i]!;
    await prisma.whopProduct.create({
      data: {
        practitionerId: p.id,
        title: o.title,
        description: o.description,
        priceUsdCents: o.cents,
        duration: o.duration,
        sortOrder: i,
        bookingLinkId: linkId,
      },
    });
  }
  return p.slug;
}

async function main() {
  await make({
    slug: 'acuity-case',
    name: 'Sara Acuity',
    // A real Acuity host so the adapter's camelCase params are exercised; the page is only ever
    // LOADED, never booked against.
    linkUrl: 'https://wildandrooted.as.me/connection',
    linkLabel: 'Book a session',
    qualifications: [
      'BS in Nutrition, Bastyr University',
      'Certified Herbalist, Holistic Health Educators',
      'Functional Medicine Practitioner (IFM)',
    ],
    offerings: [
      {
        title: '90-minute Deep Dive',
        cents: 19900,
        duration: 90,
        description:
          'A full intake covering history, labs and current symptoms.\n\nYou leave with a written protocol and a follow-up plan — this second paragraph exists to prove the detail formats rather than running together as one block.',
      },
      { title: 'Follow-up Session', cents: 8900, duration: 45, description: 'A shorter check-in.' },
      { title: 'Pantry Reset Package', cents: 4900, duration: 30, description: 'Practical swaps.' },
    ],
  });

  await make({
    slug: 'calendly-case',
    name: 'Cal Calendly',
    linkUrl: 'https://calendly.com/emanneteale/30min',
    linkLabel: 'Intro call',
    qualifications: ['MSc Nutritional Therapy'],
    offerings: [
      { title: 'Intro Consultation', cents: 0, duration: 30, description: 'A first conversation.' },
    ],
  });

  await make({
    slug: 'null-case',
    name: 'Nadia Nulladapter',
    // Unknown host → the null adapter, which must still complete the flow with no prefill.
    linkUrl: 'https://bookings.example.com/nadia',
    linkLabel: 'Schedule with me',
    offerings: [
      { title: 'Standard Session', cents: 12000, duration: 60, description: 'One hour together.' },
    ],
  });

  // §3 SHAPE A — the TYPICAL free consult: a bare Booking Link, zero Offerings, no Whop item.
  await make({
    slug: 'consult-case',
    name: 'Freya Freeconsult',
    linkUrl: 'https://calendly.com/emanneteale/30min',
    linkLabel: 'Free 15-minute intro call',
    offerings: [],
  });

  console.log('seeded: acuity-case, calendly-case, null-case, consult-case');
}

main().finally(() => prisma.$disconnect());
