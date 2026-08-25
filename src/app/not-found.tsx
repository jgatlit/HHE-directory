import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { Card } from '@/components/ui/card';

// Root not-found boundary. Without this file, notFound() calls throughout the
// app (practitioners/[slug], book, book/[token], edit) had no App Router
// not-found segment to render into, so Next served this same "not found"
// copy with an HTTP 200 status instead of 404 — see GH issue history for the
// full trust/SEO impact (crawlers indexing dead listings as live pages).
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-16">
      <Card className="max-w-md space-y-4 p-8 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-muted">
          <SearchX className="h-5 w-5 text-muted-foreground" aria-hidden />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold tracking-tight">Page not found</h1>
          <p className="text-sm text-muted-foreground">
            This page doesn&apos;t exist or may have been removed.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href="/search"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Browse practitioners
          </Link>
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-md border bg-card px-5 text-sm font-medium hover:bg-accent"
          >
            Go home
          </Link>
        </div>
      </Card>
    </main>
  );
}
