import type { Prisma } from '@prisma/client';

/**
 * Shared display ordering for practitioner-controlled lists.
 *
 * These exist as shared constants rather than inline literals because the bug they fix was a
 * DIVERGENCE, not a missing sort: the dashboard ordered offerings `createdAt: 'desc'` and the
 * public profile ordered them `createdAt: 'asc'`, so a practitioner arranged her offerings in one
 * view and saw them reversed in the other. Two literals can drift apart; one import cannot.
 *
 * Every read of these lists — profile, dashboard, directory cards, search indexing — uses these.
 */

/**
 * Ties break on price ascending, so a practitioner who has never dragged anything still gets
 * lowest-to-highest rather than insertion order. That is the explicit fallback Sarah Schindler
 * asked for ("or at least have it by price from lowest to highest", 2026-08-12); `createdAt` is
 * the final tiebreak only so equal-priced offerings stay stable between requests.
 */
export const OFFERING_ORDER: Prisma.WhopProductOrderByWithRelationInput[] = [
  { sortOrder: 'asc' },
  { priceUsdCents: 'asc' },
  { createdAt: 'asc' },
];

/**
 * `PractitionerSpecialty` has no `createdAt`, so the deterministic tiebreak is the canonical
 * specialty name. Before this, no query ordered these at all and Postgres returned join rows in
 * unspecified order — genuinely non-deterministic between requests, which is what Sarah saw.
 */
export const SPECIALTY_ORDER: Prisma.PractitionerSpecialtyOrderByWithRelationInput[] = [
  { sortOrder: 'asc' },
  { specialty: { name: 'asc' } },
];
