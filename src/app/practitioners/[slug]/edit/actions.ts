'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { Prisma } from '@prisma/client';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { indexPractitioner } from '@/lib/practitioner-indexer';
import { syncSpecialtySynonyms } from '@/lib/typesense-synonyms';
import { draftProfile, type DraftSpecialty } from '@/lib/onboarding-draft';
import { findPlace, VIRTUAL_PLACE } from '@/lib/city-catalog';
import {
  createAccountLink,
  createConnectedAccount,
  createOfferingCheckout,
  createSubscriptionCheckout,
  WHOP_OFFERING_TITLE_MAX,
} from '@/lib/whop';

async function authorizeForSlug(slug: string) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/auth/signin?callbackUrl=/practitioners/${slug}/edit`);
  }
  const practitioner = await prisma.practitioner.findUnique({
    where: { slug },
    select: { id: true, userId: true },
  });
  if (!practitioner) {
    redirect('/auth/error?error=AccessDenied');
  }
  const isOwner = practitioner.userId === session.user.id;
  const isAdmin = session.user.role === 'ADMIN';
  if (!isOwner && !isAdmin) {
    redirect('/auth/error?error=AccessDenied');
  }
  return practitioner;
}

function buildSearchText(parts: (string | null | undefined)[]): string {
  return parts.filter((p) => p && p.trim()).join(' \n ');
}

const normLabel = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'specialty';
}

type RawSelection = { specialtyId: string | null; rawLabel: string };

/**
 * Resolve one combobox selection → a canonical specialtyId + the practitioner's rawLabel.
 * - Picked canonical → use it.
 * - Free-text that matches an existing alias/canonical (normalized) → reuse that canonical.
 * - Genuinely novel free-text → create a PROPOSED canonical + PENDING alias (the
 *   /admin/specialties moderation queue). Practitioner goes live immediately, never blocked.
 * Returns null when the rawLabel is empty.
 */
async function resolveSelection(
  tx: Prisma.TransactionClient,
  sel: RawSelection,
): Promise<{ specialtyId: string; rawLabel: string } | null> {
  const rawLabel = sel.rawLabel.trim();
  if (!rawLabel) return null;
  if (sel.specialtyId) return { specialtyId: sel.specialtyId, rawLabel };

  const label = normLabel(rawLabel);

  const alias = await tx.specialtyAlias.findUnique({ where: { label } });
  if (alias) return { specialtyId: alias.specialtyId, rawLabel };

  const byName = await tx.specialty.findFirst({
    where: { name: { equals: rawLabel, mode: 'insensitive' } },
  });
  if (byName) return { specialtyId: byName.id, rawLabel };

  // Novel — create a PROPOSED canonical (unique slug) + PENDING alias.
  let slug = slugify(rawLabel);
  if (await tx.specialty.findUnique({ where: { slug } })) slug = `${slug}-${Date.now().toString(36)}`;
  const created = await tx.specialty.create({
    data: { slug, name: rawLabel, status: 'PROPOSED' },
  });
  await tx.specialtyAlias.create({
    data: { label, specialtyId: created.id, source: 'PRACTITIONER', status: 'PENDING' },
  });
  return { specialtyId: created.id, rawLabel };
}

function normalizeUrl(raw: string, allowlist: string[]): string | null {
  if (!raw) return null;
  let candidate = raw.trim();
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const knownish = allowlist.some((h) => host === h || host.endsWith(`.${h}`));
    if (!knownish && !host.includes('.')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

const BOOKING_HOSTS = [
  'cal.com',
  'app.cal.com',
  'calendly.com',
  'savvycal.com',
  'tidycal.com',
  'koalendar.com',
  'youcanbookme.com',
  'acuityscheduling.com',
];

function normalizeBookingUrl(raw: string): string | null {
  return normalizeUrl(raw, BOOKING_HOSTS);
}

// Website is an open field (any host) — accept any valid http(s) URL, null when blank/invalid.
function normalizeWebsiteUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return normalizeUrl(trimmed, []);
}

// Approx city centroids for the haversine "near me" index — Phase 2.5 can add
// per-practitioner overrides. Shared by updatePractitioner + submitOnboarding.
const CITY_COORDS: Record<string, [number, number]> = {
  atlanta: [33.749, -84.388],
  savannah: [32.0809, -81.0912],
  athens: [33.9519, -83.3576],
  macon: [32.8407, -83.6324],
  augusta: [33.4735, -82.0105],
  decatur: [33.7748, -84.2963],
  asheville: [35.5951, -82.5515],
  boulder: [40.015, -105.2705],
  austin: [30.2672, -97.7431],
  portland: [45.5152, -122.6784],
  nashville: [36.1627, -86.7816],
  charleston: [32.7765, -79.9311],
  sedona: [34.8697, -111.761],
};

/**
 * Find-or-create a City from free-text input, and hand back coordinates for the haversine index.
 *
 * The form used to post a `cityId` chosen from a fixed 14-row `<select>`, which locked out every
 * practitioner outside those 14 — and a missing city fails isProfileComplete() → isListed(), so
 * the lockout was silent invisibility, not a visible error. See CityField for the full note.
 *
 * Normalization is the whole job. `cityName`/`cityState` are Typesense facets, so "chicago",
 * "Chicago" and "CHICAGO " must converge on one row or the facet list fragments. Matching is on
 * City's (slug, state) unique key with a slugified name and an upper-cased state, while the
 * stored `name` keeps Census casing (or the practitioner's, for a place the catalog doesn't know).
 *
 * Coordinates come from the Census catalog rather than CITY_COORDS. That hand-maintained map has
 * 14 entries, so before this every practitioner-created city had no lat/long and silently dropped
 * out of the "near me" ranking. CITY_COORDS is still consulted as a fallback so the original
 * seeded cities keep the exact coordinates they were tuned with.
 */
async function resolveCity(
  rawName: string,
  rawState: string,
): Promise<{ id: string; name: string; state: string; coords: [number, number] | null } | null> {
  // The typeahead offers "Chicago, IL" as one value, because there are nine Atlantas. Split the
  // trailing state back off; an explicit state field still wins if the practitioner set one.
  let name = rawName.trim().replace(/\s+/g, ' ');
  let stateRaw = rawState.trim().replace(/\s+/g, ' ');
  const paired = name.match(/^(.*?),\s*([A-Za-z]{2,7})$/);
  if (paired) {
    name = paired[1].trim();
    if (!stateRaw) stateRaw = paired[2];
  }
  if (!name) return null;

  const slug = slugify(name);
  if (!slug || slug === 'specialty') return null; // slugify's fallback: nothing usable survived

  // "Online" is the sentinel for a virtual-only practice — title-cased, not an abbreviation.
  const state = /^online$/i.test(stateRaw) ? 'Online' : stateRaw.toUpperCase() || 'Online';

  const known = findPlace(name, state);
  const city = await prisma.city.upsert({
    where: { slug_state: { slug, state } },
    create: { slug, name: known?.name ?? name, state },
    update: {},
  });

  const seeded = CITY_COORDS[city.slug];
  const coords: [number, number] | null =
    seeded ?? (known && known !== VIRTUAL_PLACE ? [known.lat, known.lon] : null);
  return { id: city.id, name: city.name, state: city.state, coords };
}

export async function updatePractitioner(slug: string, formData: FormData): Promise<void> {
  const target = await authorizeForSlug(slug);

  const displayName = String(formData.get('displayName') ?? '').trim();
  const bio = String(formData.get('bio') ?? '').trim();
  const headline = String(formData.get('headline') ?? '').trim() || null;
  const tagline = String(formData.get('tagline') ?? '').trim() || null;
  const whoIHelp = String(formData.get('whoIHelp') ?? '').trim() || null;
  const websiteUrl = normalizeWebsiteUrl(String(formData.get('websiteUrl') ?? ''));
  const telehealth = formData.get('telehealth') === 'on' || formData.get('telehealth') === 'true';
  const inPerson = formData.get('inPerson') === 'on' || formData.get('inPerson') === 'true';
  const resolvedCity = await resolveCity(
    String(formData.get('cityName') ?? ''),
    String(formData.get('cityState') ?? ''),
  );
  const cityId = resolvedCity?.id ?? null;
  const photoUrl = String(formData.get('photoUrl') ?? '').trim() || null;
  const yearsRaw = String(formData.get('yearsInPractice') ?? '').trim();
  const yearsInPractice = yearsRaw === '' ? null : Math.max(0, parseInt(yearsRaw, 10) || 0);

  let rawSelections: RawSelection[] = [];
  try {
    const parsed = JSON.parse(String(formData.get('specialtiesJson') ?? '[]'));
    if (Array.isArray(parsed)) {
      rawSelections = parsed
        .map((p) => ({
          specialtyId: typeof p.specialtyId === 'string' ? p.specialtyId : null,
          rawLabel: typeof p.rawLabel === 'string' ? p.rawLabel : '',
        }))
        .filter((p) => p.rawLabel.trim());
    }
  } catch {
    rawSelections = [];
  }

  if (!displayName) {
    redirect(`/practitioners/${slug}/edit?error=name-required`);
  }

  // Booking links: paired bookingLabel/bookingUrl rows zipped by index. Skip empty
  // rows, validate each URL against the provider allowlist, dedupe by normalized URL.
  const bookingLabels = formData.getAll('bookingLabel').map((s) => String(s));
  const bookingUrlsRaw = formData.getAll('bookingUrl').map((s) => String(s).trim());
  const bookingLinks: { label: string | null; url: string }[] = [];
  const seenBookingUrls = new Set<string>();
  for (let i = 0; i < bookingUrlsRaw.length; i++) {
    const raw = bookingUrlsRaw[i];
    if (!raw) continue;
    const url = normalizeBookingUrl(raw);
    if (!url) {
      redirect(`/practitioners/${slug}/edit?error=invalid-booking-url`);
    }
    if (seenBookingUrls.has(url)) continue;
    seenBookingUrls.add(url);
    const label = (bookingLabels[i] ?? '').trim() || null;
    bookingLinks.push({ label, url });
  }

  // City coords for haversine — resolved alongside the city itself, so a practitioner-created
  // city gets Census coordinates instead of silently having none.
  const coords = resolvedCity?.coords ?? null;

  let createdNewTaxonomy = false;

  await prisma.$transaction(async (tx) => {
    // Resolve combobox selections → canonical ids (+ create PROPOSED/PENDING for novel terms)
    const resolved: { specialtyId: string; rawLabel: string }[] = [];
    const seen = new Set<string>();
    for (const sel of rawSelections) {
      const before = await tx.specialty.count();
      const r = await resolveSelection(tx, sel);
      if (!r || seen.has(r.specialtyId)) continue;
      if ((await tx.specialty.count()) > before) createdNewTaxonomy = true;
      seen.add(r.specialtyId);
      resolved.push(r);
    }

    // Canonical names (+ parents) for searchText
    const specialtyRows = await tx.specialty.findMany({
      where: { id: { in: resolved.map((r) => r.specialtyId) } },
      include: { parent: true },
    });
    const canonicalNames = Array.from(
      new Set(specialtyRows.flatMap((s) => (s.parent ? [s.name, s.parent.name] : [s.name]))),
    );
    const rawLabels = resolved.map((r) => r.rawLabel);

    await tx.practitionerSpecialty.deleteMany({ where: { practitionerId: target.id } });
    await tx.bookingLink.deleteMany({ where: { practitionerId: target.id } });
    await tx.practitioner.update({
      where: { id: target.id },
      data: {
        displayName,
        bio: bio || null,
        photoUrl,
        headline,
        tagline,
        whoIHelp,
        websiteUrl,
        telehealth,
        inPerson,
        cityId,
        latitude: coords?.[0] ?? null,
        longitude: coords?.[1] ?? null,
        yearsInPractice,
        searchText: buildSearchText([
          displayName,
          headline,
          bio,
          whoIHelp,
          resolvedCity?.name,
          resolvedCity?.state,
          ...rawLabels,
          ...canonicalNames,
        ]),
        specialties: {
          // Index IS the order: `resolved` follows specialtiesJson, which follows the order the
          // practitioner arranged the chips in. Persisting it here is what makes drag-to-sort
          // work without a separate reorder action.
          create: resolved.map((r, idx) => ({
            rawLabel: r.rawLabel,
            sortOrder: idx,
            specialty: { connect: { id: r.specialtyId } },
          })),
        },
        bookingLinks: {
          create: bookingLinks.map((b, idx) => ({
            label: b.label,
            url: b.url,
            sortOrder: idx,
          })),
        },
      },
    });
  });

  await indexPractitioner(target.id).catch((err) =>
    console.error('Typesense reindex failed:', err),
  );
  // New rawLabels / proposed canonicals change the synonym groups — resync (cheap, no reindex).
  if (createdNewTaxonomy || rawSelections.length > 0) {
    await syncSpecialtySynonyms().catch((err) =>
      console.error('Typesense synonym sync failed:', err),
    );
  }

  revalidatePath(`/practitioners/${slug}`);
  revalidatePath(`/practitioners/${slug}/edit`);
  revalidatePath('/');
  revalidatePath('/search');
  redirect(`/practitioners/${slug}/edit?saved=1`);
}

/**
 * Resolve one AI-drafted specialty → canonical id, writing the proposed mapping as
 * an IMPORT/PENDING SpecialtyAlias with the LLM confidence (Task B spec). Mirrors
 * resolveSelection but the proposal always lands in the moderation queue (PENDING)
 * with source=IMPORT, and novel canonicals are created PROPOSED.
 */
async function resolveDraftSpecialty(
  tx: Prisma.TransactionClient,
  d: DraftSpecialty,
): Promise<{ specialtyId: string; rawLabel: string } | null> {
  const rawLabel = d.rawLabel.trim();
  if (!rawLabel) return null;
  const label = normLabel(rawLabel);

  // Already-known phrasing → reuse its canonical (don't disturb an approved alias).
  const existingAlias = await tx.specialtyAlias.findUnique({ where: { label } });
  if (existingAlias) return { specialtyId: existingAlias.specialtyId, rawLabel };

  // Map to the proposed canonical: by slug, then by name, else create a PROPOSED node.
  let canonical =
    (await tx.specialty.findUnique({ where: { slug: d.canonicalSlug } })) ||
    (await tx.specialty.findFirst({
      where: { name: { equals: d.canonicalName, mode: 'insensitive' } },
    }));
  if (!canonical) {
    let slug = slugify(d.canonicalSlug || d.canonicalName);
    if (await tx.specialty.findUnique({ where: { slug } })) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }
    canonical = await tx.specialty.create({
      data: { slug, name: d.canonicalName || rawLabel, status: 'PROPOSED' },
    });
  }

  await tx.specialtyAlias.create({
    data: {
      label,
      specialtyId: canonical.id,
      source: 'IMPORT',
      status: 'PENDING',
      confidence: d.confidence,
    },
  });
  return { specialtyId: canonical.id, rawLabel };
}

/**
 * AI onboarding DRAFT step (Task B). Reads the practitioner's raw self-description,
 * drafts profile fields via the LLM (or template fallback), and persists them as a
 * reviewable starting point — the practitioner then edits/overrides each field in the
 * form below and clicks Save to publish. Drafted specialties write IMPORT/PENDING
 * aliases (moderation queue); drafted case studies are persisted for review/removal.
 */
export async function generateDraftAction(slug: string, formData: FormData): Promise<void> {
  const target = await authorizeForSlug(slug);
  const rawSource = String(formData.get('draftSource') ?? '').trim();

  const [practitioner, catalog] = await Promise.all([
    prisma.practitioner.findUnique({
      where: { id: target.id },
      select: {
        displayName: true,
        headline: true,
        tagline: true,
        whoIHelp: true,
        bio: true,
        specialties: { select: { rawLabel: true } },
      },
    }),
    prisma.specialty.findMany({
      where: { status: { in: ['ACTIVE', 'PROPOSED'] } },
      select: { slug: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  if (!practitioner) redirect('/auth/error?error=AccessDenied');

  const { draft, source } = await draftProfile({
    displayName: practitioner.displayName,
    rawSource,
    existing: {
      headline: practitioner.headline,
      tagline: practitioner.tagline,
      whoIHelp: practitioner.whoIHelp,
      bio: practitioner.bio,
      rawLabels: practitioner.specialties
        .map((s) => s.rawLabel?.trim())
        .filter((s): s is string => !!s),
    },
    canonicalCatalog: catalog,
  });

  await prisma.$transaction(async (tx) => {
    const resolved: { specialtyId: string; rawLabel: string }[] = [];
    const seen = new Set<string>();
    for (const d of draft.specialties) {
      const r = await resolveDraftSpecialty(tx, d);
      if (!r || seen.has(r.specialtyId)) continue;
      seen.add(r.specialtyId);
      resolved.push(r);
    }

    const specialtyRows = await tx.specialty.findMany({
      where: { id: { in: resolved.map((r) => r.specialtyId) } },
      include: { parent: true },
    });
    const canonicalNames = Array.from(
      new Set(specialtyRows.flatMap((s) => (s.parent ? [s.name, s.parent.name] : [s.name]))),
    );

    await tx.practitionerSpecialty.deleteMany({ where: { practitionerId: target.id } });
    await tx.practitioner.update({
      where: { id: target.id },
      data: {
        headline: draft.headline || null,
        tagline: draft.tagline || null,
        whoIHelp: draft.whoIHelp || null,
        bio: draft.bio || null,
        searchText: buildSearchText([
          practitioner.displayName,
          draft.headline,
          draft.bio,
          draft.whoIHelp,
          ...draft.modalities,
          ...draft.specialties.map((s) => s.rawLabel),
          ...canonicalNames,
        ]),
        specialties: {
          // Index IS the order: `resolved` follows specialtiesJson, which follows the order the
          // practitioner arranged the chips in. Persisting it here is what makes drag-to-sort
          // work without a separate reorder action.
          create: resolved.map((r, idx) => ({
            rawLabel: r.rawLabel,
            sortOrder: idx,
            specialty: { connect: { id: r.specialtyId } },
          })),
        },
      },
    });

    // Replace any prior AI-drafted case studies with the fresh draft (reviewable below).
    await tx.caseStudy.deleteMany({ where: { practitionerId: target.id } });
    for (const cs of draft.caseStudies) {
      await tx.caseStudy.create({
        data: {
          practitionerId: target.id,
          title: cs.title,
          summary: cs.summary,
          outcome: cs.outcome ?? null,
          anonymized: true,
        },
      });
    }
  });

  await indexPractitioner(target.id).catch((err) =>
    console.error('Typesense reindex failed:', err),
  );
  await syncSpecialtySynonyms().catch((err) =>
    console.error('Typesense synonym sync failed:', err),
  );

  revalidatePath(`/practitioners/${slug}/edit`);
  redirect(`/practitioners/${slug}/edit?drafted=1&source=${source}`);
}

/** Remove one AI-drafted case study during review. */
export async function removeCaseStudy(slug: string, caseStudyId: string): Promise<void> {
  const target = await authorizeForSlug(slug);
  await prisma.caseStudy.deleteMany({ where: { id: caseStudyId, practitionerId: target.id } });
  revalidatePath(`/practitioners/${slug}/edit`);
  redirect(`/practitioners/${slug}/edit`);
}

/**
 * Onboarding submit (Phase 1). The onboarding form collects the basics + a free-text
 * "describe your practice", then this action ONE-SHOT generates the landing page:
 * persists the structured basics + user-picked specialties, runs draftProfile() to
 * normalize the description into headline/whoIHelp/bio (+ modalities, case studies),
 * then sends the practitioner to their freshly generated public page. Works for both
 * the pre-filled (revise → regenerate) and blank (fill → generate) invite cases;
 * ongoing field-level edits happen afterward in the admin portal (updatePractitioner).
 */
export async function submitOnboarding(slug: string, formData: FormData): Promise<void> {
  const target = await authorizeForSlug(slug);

  const displayName = String(formData.get('displayName') ?? '').trim();
  if (!displayName) {
    redirect(`/practitioners/${slug}/edit?error=name-required`);
  }
  const resolvedCity = await resolveCity(
    String(formData.get('cityName') ?? ''),
    String(formData.get('cityState') ?? ''),
  );
  const cityId = resolvedCity?.id ?? null;
  const telehealth = formData.get('telehealth') === 'on' || formData.get('telehealth') === 'true';
  const inPerson = formData.get('inPerson') === 'on' || formData.get('inPerson') === 'true';
  const yearsRaw = String(formData.get('yearsInPractice') ?? '').trim();
  const yearsInPractice = yearsRaw === '' ? null : Math.max(0, parseInt(yearsRaw, 10) || 0);
  const draftSource = String(formData.get('draftSource') ?? '').trim();

  let rawSelections: RawSelection[] = [];
  try {
    const parsed = JSON.parse(String(formData.get('specialtiesJson') ?? '[]'));
    if (Array.isArray(parsed)) {
      rawSelections = parsed
        .map((p) => ({
          specialtyId: typeof p.specialtyId === 'string' ? p.specialtyId : null,
          rawLabel: typeof p.rawLabel === 'string' ? p.rawLabel : '',
        }))
        .filter((p) => p.rawLabel.trim());
    }
  } catch {
    rawSelections = [];
  }

  const coords = resolvedCity?.coords ?? null;

  const [existing, catalog] = await Promise.all([
    prisma.practitioner.findUnique({
      where: { id: target.id },
      select: { headline: true, tagline: true, whoIHelp: true, bio: true, specialties: { select: { rawLabel: true } } },
    }),
    prisma.specialty.findMany({
      where: { status: { in: ['ACTIVE', 'PROPOSED'] } },
      select: { slug: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  // One-shot: normalize the practitioner's own words into a polished landing page.
  const { draft } = await draftProfile({
    displayName,
    rawSource: draftSource,
    existing: {
      headline: existing?.headline ?? null,
      tagline: existing?.tagline ?? null,
      whoIHelp: existing?.whoIHelp ?? null,
      bio: existing?.bio ?? null,
      rawLabels: (existing?.specialties ?? [])
        .map((s) => s.rawLabel?.trim())
        .filter((s): s is string => !!s),
    },
    canonicalCatalog: catalog,
  });

  let createdNewTaxonomy = false;

  await prisma.$transaction(async (tx) => {
    const resolved: { specialtyId: string; rawLabel: string }[] = [];
    const seen = new Set<string>();
    for (const sel of rawSelections) {
      const before = await tx.specialty.count();
      const r = await resolveSelection(tx, sel);
      if (!r || seen.has(r.specialtyId)) continue;
      if ((await tx.specialty.count()) > before) createdNewTaxonomy = true;
      seen.add(r.specialtyId);
      resolved.push(r);
    }

    const specialtyRows = await tx.specialty.findMany({
      where: { id: { in: resolved.map((r) => r.specialtyId) } },
      include: { parent: true },
    });
    const canonicalNames = Array.from(
      new Set(specialtyRows.flatMap((s) => (s.parent ? [s.name, s.parent.name] : [s.name]))),
    );
    const rawLabels = resolved.map((r) => r.rawLabel);

    await tx.practitionerSpecialty.deleteMany({ where: { practitionerId: target.id } });
    await tx.practitioner.update({
      where: { id: target.id },
      data: {
        displayName,
        headline: draft.headline || null,
        tagline: draft.tagline || null,
        whoIHelp: draft.whoIHelp || null,
        bio: draft.bio || null,
        cityId,
        telehealth,
        inPerson,
        latitude: coords?.[0] ?? null,
        longitude: coords?.[1] ?? null,
        yearsInPractice,
        searchText: buildSearchText([
          displayName,
          draft.headline,
          draft.bio,
          draft.whoIHelp,
          resolvedCity?.name,
          resolvedCity?.state,
          ...draft.modalities,
          ...rawLabels,
          ...canonicalNames,
        ]),
        specialties: {
          // Index IS the order: `resolved` follows specialtiesJson, which follows the order the
          // practitioner arranged the chips in. Persisting it here is what makes drag-to-sort
          // work without a separate reorder action.
          create: resolved.map((r, idx) => ({
            rawLabel: r.rawLabel,
            sortOrder: idx,
            specialty: { connect: { id: r.specialtyId } },
          })),
        },
      },
    });

    // Fresh AI-drafted outcomes (reviewable/removable later in the portal).
    await tx.caseStudy.deleteMany({ where: { practitionerId: target.id } });
    for (const cs of draft.caseStudies) {
      await tx.caseStudy.create({
        data: {
          practitionerId: target.id,
          title: cs.title,
          summary: cs.summary,
          outcome: cs.outcome ?? null,
          anonymized: true,
        },
      });
    }
  });

  await indexPractitioner(target.id).catch((err) =>
    console.error('Typesense reindex failed:', err),
  );
  if (createdNewTaxonomy || rawSelections.length > 0) {
    await syncSpecialtySynonyms().catch((err) =>
      console.error('Typesense synonym sync failed:', err),
    );
  }

  revalidatePath(`/practitioners/${slug}`);
  revalidatePath('/');
  revalidatePath('/search');
  redirect(`/practitioners/${slug}?onboarded=1`);
}

// ---- Offerings (Phase 2) ----
// Practitioner-configured offerings stored locally in WhopProduct. Payments are wired in
// Layer Y (whopProductId/purchaseUrl stay null until then), so no Typesense reindex here.

function parsePriceToCents(raw: FormDataEntryValue | null): number {
  const s = String(raw ?? '').replace(/[^0-9.]/g, '').trim();
  const dollars = parseFloat(s);
  if (!s || !Number.isFinite(dollars) || dollars < 0) return 0;
  // Clamp under Postgres INT4 max ($21.47M) so an oversized price can't overflow the column.
  return Math.min(Math.round(dollars * 100), 2_000_000_00);
}

function offeringInterval(raw: FormDataEntryValue | null): 'ONE_TIME' | 'MONTHLY' {
  return raw === 'MONTHLY' ? 'MONTHLY' : 'ONE_TIME';
}

export async function createOffering(slug: string, formData: FormData): Promise<void> {
  const target = await authorizeForSlug(slug);
  const title = String(formData.get('title') ?? '').trim();
  if (!title) redirect(`/practitioners/${slug}/edit?error=offering-title#offerings`);
  await prisma.whopProduct.create({
    data: {
      practitionerId: target.id,
      title,
      description: String(formData.get('description') ?? '').trim() || null,
      category: String(formData.get('category') ?? '').trim() || null,
      interval: offeringInterval(formData.get('interval')),
      priceUsdCents: parsePriceToCents(formData.get('price')),
    },
  });
  revalidatePath(`/practitioners/${slug}`);
  revalidatePath(`/practitioners/${slug}/edit`);
  redirect(`/practitioners/${slug}/edit?saved=offering#offerings`);
}

export async function updateOffering(slug: string, formData: FormData): Promise<void> {
  const target = await authorizeForSlug(slug);
  const id = String(formData.get('offeringId') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  if (!id || !title) redirect(`/practitioners/${slug}/edit?error=offering-title#offerings`);
  // updateMany scoped by practitionerId = the ownership check (no cross-practitioner edits).
  await prisma.whopProduct.updateMany({
    where: { id, practitionerId: target.id },
    data: {
      title,
      description: String(formData.get('description') ?? '').trim() || null,
      category: String(formData.get('category') ?? '').trim() || null,
      interval: offeringInterval(formData.get('interval')),
      priceUsdCents: parsePriceToCents(formData.get('price')),
    },
  });
  revalidatePath(`/practitioners/${slug}`);
  revalidatePath(`/practitioners/${slug}/edit`);
  redirect(`/practitioners/${slug}/edit?saved=offering#offerings`);
}

export async function deleteOffering(slug: string, formData: FormData): Promise<void> {
  const target = await authorizeForSlug(slug);
  const id = String(formData.get('offeringId') ?? '');
  if (id) await prisma.whopProduct.deleteMany({ where: { id, practitionerId: target.id } });
  revalidatePath(`/practitioners/${slug}`);
  revalidatePath(`/practitioners/${slug}/edit`);
  redirect(`/practitioners/${slug}/edit#offerings`);
}

/**
 * Persist a practitioner's chosen offering order.
 *
 * Offerings need an explicit action where specialties and booking links do not: those two ride
 * along in the profile form, so their submission order IS their sortOrder. Offerings are separate
 * rows behind their own create/update/delete actions, with no containing form to carry an order.
 *
 * `updateMany` per id is scoped by practitionerId as well, so a forged id in the posted list
 * cannot renumber somebody else's offerings — the ownership check on the action authorises the
 * practitioner, not each id they send.
 */
export async function reorderOfferings(slug: string, formData: FormData): Promise<void> {
  const target = await authorizeForSlug(slug);
  let ids: string[] = [];
  try {
    const parsed = JSON.parse(String(formData.get('orderJson') ?? '[]'));
    if (Array.isArray(parsed)) ids = parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return;
  }
  if (ids.length === 0) return;

  await prisma.$transaction(
    ids.map((id, sortOrder) =>
      prisma.whopProduct.updateMany({
        where: { id, practitionerId: target.id },
        data: { sortOrder },
      }),
    ),
  );

  revalidatePath(`/practitioners/${slug}`);
  revalidatePath(`/practitioners/${slug}/edit`);
}

// ---- Whop payments (Layer X subscription + Layer Y connected-account offerings) ----
// Every Whop call below can throw (WhopNotConfigured, network, API error). redirect() itself
// works by throwing, so each action does its Whop/DB work inside try/catch capturing a result
// or error flag, then calls redirect() AFTER the try/catch — never inside it, or a success
// would get caught by its own catch and reported back as a failure.

export async function startSubscriptionCheckout(slug: string): Promise<void> {
  const target = await authorizeForSlug(slug);

  let redirectUrl: string | null = null;
  try {
    // Mint-once-and-reuse: never mint a second checkout config for the same practitioner.
    const practitioner = await prisma.practitioner.findUnique({
      where: { id: target.id },
      select: { whopSubscriptionCheckoutUrl: true },
    });
    if (practitioner?.whopSubscriptionCheckoutUrl) {
      redirectUrl = practitioner.whopSubscriptionCheckoutUrl;
    } else {
      const { purchaseUrl } = await createSubscriptionCheckout({ practitionerId: target.id, slug });
      await prisma.practitioner.update({
        where: { id: target.id },
        data: { whopSubscriptionCheckoutUrl: purchaseUrl },
      });
      redirectUrl = purchaseUrl;
    }
  } catch (err) {
    console.error('Whop subscription checkout failed:', err);
  }

  redirect(redirectUrl ?? `/practitioners/${slug}/edit?whop=error#payments`);
}

export async function startWhopOnboarding(slug: string): Promise<void> {
  const target = await authorizeForSlug(slug);

  let linkUrl: string | null = null;
  try {
    const practitioner = await prisma.practitioner.findUnique({
      where: { id: target.id },
      select: { displayName: true, whopCompanyId: true, user: { select: { email: true } } },
    });

    // companies.create is NOT idempotent — Whop will happily mint a second connected company
    // for the same practitioner. Re-read whopCompanyId right here and only ever create when
    // it's still unset, then persist the new id immediately (before minting the account link,
    // which can itself fail) so a retry after a partial failure never creates a second one.
    let companyId = practitioner?.whopCompanyId ?? null;
    if (!companyId && practitioner?.user.email) {
      const created = await createConnectedAccount({
        practitionerId: target.id,
        slug,
        displayName: practitioner.displayName || slug,
        email: practitioner.user.email,
      });
      companyId = created.companyId;
      await prisma.practitioner.update({
        where: { id: target.id },
        data: { whopCompanyId: companyId, whopCompanyCreatedAt: new Date() },
      });
    }

    if (companyId) {
      const link = await createAccountLink({ companyId, slug, useCase: 'account_onboarding' });
      linkUrl = link.url;
    }
  } catch (err) {
    console.error('Whop onboarding failed:', err);
  }

  redirect(linkUrl ?? `/practitioners/${slug}/edit?whop=error#payments`);
}

export async function openPayoutPortal(slug: string): Promise<void> {
  const target = await authorizeForSlug(slug);

  let linkUrl: string | null = null;
  try {
    const practitioner = await prisma.practitioner.findUnique({
      where: { id: target.id },
      select: { whopCompanyId: true },
    });
    if (practitioner?.whopCompanyId) {
      const link = await createAccountLink({
        companyId: practitioner.whopCompanyId,
        slug,
        useCase: 'payouts_portal',
      });
      linkUrl = link.url;
    }
  } catch (err) {
    console.error('Whop payout portal failed:', err);
  }

  redirect(linkUrl ?? `/practitioners/${slug}/edit?whop=error#payments`);
}

export async function publishOffering(slug: string, formData: FormData): Promise<void> {
  const target = await authorizeForSlug(slug);
  const offeringId = String(formData.get('offeringId') ?? '');

  const [practitioner, offering] = await Promise.all([
    prisma.practitioner.findUnique({
      where: { id: target.id },
      select: { whopCompanyId: true, whopPayoutsEnabled: true },
    }),
    // Ownership check, scoped by practitionerId — mirrors the updateMany scoping above; never
    // trust the id alone.
    prisma.whopProduct.findFirst({ where: { id: offeringId, practitionerId: target.id } }),
  ]);
  if (!practitioner || !offering) {
    redirect(`/practitioners/${slug}/edit?error=offering-not-found#offerings`);
  }

  // HARD GATE, not advisory: letting a patient pay into an account that cannot withdraw is the
  // worst possible failure, so no Whop call happens below until Whop itself has confirmed
  // payouts are enabled for this practitioner.
  if (!practitioner.whopPayoutsEnabled) {
    redirect(`/practitioners/${slug}/edit?error=payouts-not-ready#offerings`);
  }
  if (!practitioner.whopCompanyId || offering.priceUsdCents <= 0) {
    redirect(`/practitioners/${slug}/edit?error=offering-not-ready#offerings`);
  }
  // Whop 422s the whole checkout-config create over this (verified live 2026-07-29) — catch it
  // here with a specific, actionable redirect instead of letting it fall into the generic
  // Whop-error banner below, which gives the practitioner no idea what to fix.
  if (offering.title.length > WHOP_OFFERING_TITLE_MAX) {
    redirect(`/practitioners/${slug}/edit?error=offering-title-too-long#offerings`);
  }

  let ok = false;
  try {
    const result = await createOfferingCheckout({
      companyId: practitioner.whopCompanyId,
      offeringId: offering.id,
      practitionerId: target.id,
      slug,
      title: offering.title,
      priceUsdCents: offering.priceUsdCents,
      interval: offering.interval,
      applicationFeeCents: offering.applicationFeeCents,
    });
    await prisma.whopProduct.update({
      where: { id: offering.id },
      data: {
        whopCheckoutConfigId: result.checkoutConfigId,
        whopPlanId: result.planId,
        purchaseUrl: result.purchaseUrl,
      },
    });
    ok = true;
  } catch (err) {
    console.error('Whop publish offering failed:', err);
  }
  if (!ok) redirect(`/practitioners/${slug}/edit?whop=error#offerings`);

  revalidatePath(`/practitioners/${slug}`);
  revalidatePath(`/practitioners/${slug}/edit`);
  redirect(`/practitioners/${slug}/edit?saved=offering#offerings`);
}

export async function unpublishOffering(slug: string, formData: FormData): Promise<void> {
  const target = await authorizeForSlug(slug);
  const id = String(formData.get('offeringId') ?? '');
  // No Whop call — there is no delete endpoint for a checkout configuration, it simply stops
  // being surfaced once the public Buy button's fields are cleared.
  if (id) {
    await prisma.whopProduct.updateMany({
      where: { id, practitionerId: target.id },
      data: { whopCheckoutConfigId: null, whopPlanId: null, purchaseUrl: null },
    });
  }
  revalidatePath(`/practitioners/${slug}`);
  revalidatePath(`/practitioners/${slug}/edit`);
  redirect(`/practitioners/${slug}/edit?saved=offering#offerings`);
}
