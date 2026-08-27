/**
 * The Qualifications section heading.
 *
 * ⚠️ THE TITLE IS NOT SETTLED. Amy floated three variants on the 2026-08-26 call —
 * "certifications and education", "certifications and experience", "education and experience" —
 * and did not pick one. It is a string, so it must not hold the section: this reads an env var
 * with a default, and changing it once she decides is a Vercel env edit and a redeploy, not a
 * code change, a review and a PR.
 *
 * Deliberately NOT `NEXT_PUBLIC_` — it is only ever read while server-rendering, and a
 * `NEXT_PUBLIC_` value is inlined into the client bundle at BUILD time, which would make it
 * unchangeable without a rebuild and defeat the entire point.
 */
export const QUALIFICATIONS_HEADING =
  process.env.PROFILE_QUALIFICATIONS_HEADING?.trim() || 'Certifications & Education';
