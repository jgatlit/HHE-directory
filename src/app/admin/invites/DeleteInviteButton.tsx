'use client';

import { Trash2 } from 'lucide-react';
import { ConfirmActionButton } from './ConfirmActionButton';

type Props = {
  id: string;
  email: string;
  action: (formData: FormData) => void | Promise<void>;
};

/**
 * Delete an invitation. The arm/disarm interaction lives in ConfirmActionButton, which the
 * archive control shares — see the reasoning there for why it is one implementation and not two.
 */
export function DeleteInviteButton({ id, email, action }: Props) {
  return (
    <ConfirmActionButton
      action={action}
      fields={{ id }}
      icon={<Trash2 className="h-3.5 w-3.5" />}
      idleLabel={`Delete invitation to ${email}`}
      idleTitle="Delete this invitation"
      confirmText="Delete"
      confirmLabel={`Confirm deletion of the invitation to ${email}`}
    />
  );
}
