import 'next-auth';
import type { Role } from '@prisma/client';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: Role;
      email?: string | null;
      name?: string | null;
      image?: string | null;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: Role;
    /**
     * The `User.sessionVersion` this token was minted with. The jwt callback rejects a token
     * whose value no longer matches its user's, which is what makes "sign out everywhere"
     * possible at all — sessions use the JWT strategy, so there are no `Session` rows to delete.
     *
     * Optional because tokens issued before the column existed carry no value; those are
     * accepted once and stamped rather than signing everyone out on deploy.
     */
    sv?: number;
  }
}
