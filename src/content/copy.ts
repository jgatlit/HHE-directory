/*
 * Client-authored landing copy, supplied 2026-08-10 by Holistic Health Network, LLC / HHE.
 *
 * Strings in this file are the client's words. The disclaimer and the
 * scope-of-service ("is / is not") blocks are use-as-written and must not be
 * paraphrased — they carry legal weight. Anything the build team wrote is
 * marked `authoredByBuild: true` and is safe to revise.
 *
 * Source: docs/brand/2026-08-10-client-landing-copy.md.
 *
 * Four claims in the client's draft had no data behind them and are HELD per the
 * operator's 2026-08-10 ruling ("APPROVED COPY RESOLUTIONS" in that doc): the
 * pricing band is not rendered at all, and three strings ship in substituted
 * wording drawn from the client's own document. The doc carries the original
 * wording and the acceptance test that re-enables each one — do not restore a
 * held claim here without checking its condition has been met.
 */

export const hero = {
  title: 'Natural Health Professional Directory',
  subhead: 'Affordable, life-changing holistic health services at your fingertips',
  body: 'Access Certified Holistic Health Coaches, Holistic Health Practitioners, Therapeutic Nutritional Counselors, National Board Certified Health & Wellness Coaches, Emotion Code Practitioners, FLY Facilitators, Gut Health Specialists, Live Blood Microscopy Specialists, and more.',
  positioningLine:
    "No need to find your alternatives to mainstream medicine through TikTok, ChatGPT, or your grandma's old medicine cabinet.",
  primaryCta: 'Book a session with a trained professional in the health and wellness field.',
  wordmark: 'Natural Health Pros',
} as const;

/*
 * Rows 1 and 3 are substitutions, not the client's draft wording. "Training and
 * credential-verified" asserted a verification step that has never run
 * (hheCertified is @default(true) and no code path sets it), and "Easy
 * scheduling" was true for 1 of 13 listed practitioners. Both replacements come
 * from the client's own footer paragraph and "virtually" framing.
 */
export const trustRow = [
  'Formal training in their specialty',
  'Affordable pricing',
  'Virtual sessions',
  'Searchable directory',
] as const;

export const scopeOfService = {
  isHeading: 'Natural Health Pros is:',
  is: [
    // "(virtually or in your area)" held — 13 of 13 listed practitioners are
    // virtual and no in-person inventory exists. Future-state phrasing approved.
    'A searchable directory that helps you find trained holistic health professionals — virtually today, with in-person practitioners joining as the directory grows.',
    'A place to book sessions directly with independent practitioners.',
    "A way to see a variety of practitioners' training, specialty, and pricing before you book.",
  ],
  isNotHeading: 'Natural Health Pros is not:',
  isNot: [
    'A doctor’s office, medical clinic, or medical provider, or a replacement for your doctor or for medical care.',
    'The employer of the practitioners — each one works independently and is responsible for their own services.',
    'A guarantee of any specific health result.',
  ],
} as const;

export const socialProofMotif = '♥ Supported Professionals ♥ Happy Consumers';

export const footerIdentity = [
  'Natural Health Pros is the professional online directory for Holistic Health Network, LLC, which works in tandem with Holistic Health Educators, PMA, to elevate the standard of education and care among holistic health professionals, and to ensure greater access to these life-changing services for consumers.',
  'Practitioners listed with Natural Health Pros have received formal training in their specialty. Each practitioner is an independent provider.',
] as const;

/** USE AS WRITTEN. Do not paraphrase, truncate, or reflow into bullets. */
export const disclaimer =
  'DISCLAIMER: This is not a replacement for medical care. The practitioners listed in this directory provide holistic and complementary services that are not intended to diagnose, treat, cure, or prevent any disease. Always consult your physician or a qualified healthcare provider before making changes to your health, and never disregard or delay professional medical advice because of something you accessed through this site. If you are experiencing a medical emergency, call 911.';

/** Layer X — the practitioner-acquisition funnel. Build-authored copy. */
export const getListed = {
  authoredByBuild: true,
  eyebrow: 'For practitioners',
  heading: 'Trained through HHE? Take the listing.',
  body: 'Your listing carries your training, your specialties, your own booking link, and your own prices. You keep the client relationship — Natural Health Pros just makes you findable.',
  price: '$49',
  interval: 'per month',
  bullets: [
    'A profile page you control, with your photo, bio, and specialties',
    'Your own scheduling link — Cal.com, Calendly, Acuity, whatever you already use',
    'Listed in search the moment your profile is complete',
  ],
  cta: 'Get listed',
  secondary: 'Already listed? Sign in',
} as const;
