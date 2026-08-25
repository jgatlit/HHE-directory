# Runbook — `notFound()` silently returning HTTP 200 (streaming + `loading.tsx`)

> **Why this exists**: PR #85 (2026-08-25) fixed every route under `/practitioners/*` serving the
> "not found" page's body with a live HTTP 200 instead of 404 — a public directory's core trust
> surface lying to crawlers and status-code-based monitoring about dead/removed listings. The
> mechanism is a general Next.js App Router footgun, not specific to this route, so it will
> reproduce anywhere a `loading.tsx` (or an inline `<Suspense>`) sits above a segment that calls
> `notFound()`.

## Symptom

A route calls `notFound()` (directly, or via a helper that throws it) when a lookup misses. The
custom not-found UI renders correctly — but the response status is **200**, not 404:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://example.com/practitioners/definitely-does-not-exist
# 200   <- wrong. Body is the not-found page. Status is not.
curl -s -o /dev/null -w '%{http_code}\n' https://example.com/totally/unknown/path
# 404   <- control case (no route match at all) is unaffected — this is the tell
```

If the control case (a path with no matching route) is a correct 404 while an in-route
`notFound()` call 200s, this is the bug.

## Root cause

Once a response begins **streaming**, the HTTP status code has already been sent to the client
and can never be changed afterward. A route segment starts streaming the moment *any* Suspense
fallback commits — including the automatic one Next.js creates when a `loading.tsx` file exists
for that segment (or a parent segment; the boundary wraps the whole subtree, so a `loading.tsx` at
`app/foo/loading.tsx` affects `app/foo/page.tsx` **and every nested route under `app/foo/`**).

Sequence: `loading.tsx`'s fallback flushes with a 200 → the server commits to that status → the
async page component resolves, finds nothing, calls `notFound()` → Next can only swap the
*body* for the not-found UI; the 200 already went out on the wire.

Per Next's own docs (`docs/01-app/03-api-reference/04-functions/not-found.mdx`):

> `not-found.js` ... returns a 404 HTTP status code for non-streamed responses and a 200 status
> code for streamed responses.

And (`docs/01-app/02-guides/streaming.mdx`):

> Execute validation and call `notFound()` before any `await` or Suspense boundary to ensure a
> real HTTP 404 status code is returned. Once streaming starts, headers and status codes can no
> longer be modified.

## Why it's easy to miss

- The rendered page is byte-correct — only the status header is wrong. No visual regression, no
  console error. Nothing in `next build`'s route table flags it either (it only distinguishes
  `○` static vs `ƒ` dynamic, not streamed vs non-streamed).
- A live check that only asserts `curl ... | grep 404` (string in the body) or checks the page
  *content* passes — because the not-found body IS there. Only a check on the actual response
  **status code** catches it. (Same shape as the `NEXT_NOT_FOUND` digest showing up in the RSC
  payload while the transport-level status stays 200 — see the raw HTML dump in PR #85's
  investigation.)
- `loading.tsx` is added for a completely unrelated reason (perceived-latency polish on a slow
  query) long after the route's `notFound()` call already existed, so the regression has no
  co-located diff to review against.

## Fix

Two options, in order of preference:

1. **Do the existence check before any Suspense boundary exists for that segment.** If the route
   has no `loading.tsx` and no inline `<Suspense>` wrapping the check itself, nothing streams, and
   `notFound()` sets a real 404. This is what PR #85 did for `/practitioners/[slug]` and its
   nested `book`, `book/[token]`, and `edit` routes — remove the segment's `loading.tsx` (see
   `src/app/not-found.tsx` and its removal). Trade-off: no skeleton while the (should be fast,
   indexed) data fetch resolves.
2. **Keep the skeleton, restructure instead of removing it.** Perform a fast existence check
   synchronously at the top of the page component (no `loading.tsx` for the segment, no wrapping
   Suspense around the check itself), call `notFound()` there if it misses, and wrap **only** the
   slower, already-known-to-exist content in an inline `<Suspense fallback={...}>`. This is Next's
   documented pattern (see the `PostPage` example in `streaming.mdx`) — it preserves streaming for
   the parts that benefit from it while keeping the not-found gate synchronous. Not used here
   because the existing query already IS the fast existence check (single indexed `slug` lookup
   that returns everything the page needs) — there was no slower sub-resource to carve out.

## How to verify the fix (don't trust the build output)

Build and start a real production server — `next dev` does not reproduce this — and curl the
actual status code, not just the body:

```bash
npx next build && npx next start -p 3911
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3911/practitioners/<bad-slug>        # want 404
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3911/practitioners/<real-slug>        # want 200 (unchanged)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3911/totally/unknown/path             # 404 control, unaffected
```

Also make sure `src/app/not-found.tsx` (or the more specific segment-level one, if any) declares
its own `metadata` (at minimum a distinct `title`, ideally `robots: { index: false }`) — otherwise
a route with no route-specific `generateMetadata` override falls through to the root layout's
title, and a dead/removed page's browser tab reads identically to the live homepage.
