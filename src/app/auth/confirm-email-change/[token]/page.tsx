import { Mail, ShieldCheck } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { AuthErrorCard } from '@/components/auth/AuthErrorCard';
import { confirmEmailChange } from '@/app/auth/confirm-email-change/actions';

type Props = { params: { token: string }; searchParams: { error?: string } };

export const dynamic = 'force-dynamic';

export default async function ConfirmEmailChangePage({ params, searchParams }: Props) {
  const request = await prisma.emailChangeRequest.findUnique({ where: { token: params.token } });
  const expired = !request || request.expiresAt < new Date();

  if (searchParams.error === 'taken') {
    return (
      <AuthErrorCard
        title="That address is no longer available"
        message="Someone else registered this email address before the change was confirmed. Nothing on your account changed — request the change again with a different address."
      />
    );
  }

  if (expired) {
    return (
      <AuthErrorCard
        title="Link expired"
        message="This confirmation link is no longer valid. Go back to your profile's edit page and request the email change again."
      />
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-sm">
        <Card className="space-y-5 p-6 sm:p-8">
          <div className="space-y-2 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Mail className="h-5 w-5 text-muted-foreground" aria-hidden />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Confirm your new email</h1>
            <p className="text-sm text-muted-foreground">
              Change your Natural Health Pros sign-in address to <strong>{request.newEmail}</strong>?
            </p>
          </div>

          <Separator />

          <form action={confirmEmailChange.bind(null, params.token)} className="space-y-3">
            <button
              type="submit"
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <ShieldCheck className="h-4 w-4" />
              Confirm email change
            </button>
            <p className="text-center text-xs text-muted-foreground">
              You&apos;ll be signed out and asked to sign in again with your new address.
            </p>
          </form>
        </Card>
      </div>
    </main>
  );
}
