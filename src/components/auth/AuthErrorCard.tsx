import { Card } from '@/components/ui/card';

/** Shared error state for link-based auth flows (invite-accept, confirm-email-change) — an
 *  expired/invalid/already-used token gets the same plain, centered card rather than each route
 *  carrying its own copy. */
export function AuthErrorCard({ title, message }: { title: string; message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-sm">
        <Card className="space-y-3 p-6 sm:p-8 text-center">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{message}</p>
        </Card>
      </div>
    </main>
  );
}
