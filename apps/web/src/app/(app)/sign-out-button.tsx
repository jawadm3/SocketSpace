'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui';
import { authClient } from '@/lib/auth-client';
import { clearAllOutboxes } from '@/lib/chat/outbox';

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="ghost"
      disabled={pending}
      onClick={() => {
        setPending(true);
        // Unsent messages must not stay behind for whoever uses this browser next.
        clearAllOutboxes(browserStorage());
        void authClient.signOut().then(() => {
          router.push('/sign-in');
          router.refresh();
        });
      }}
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}
