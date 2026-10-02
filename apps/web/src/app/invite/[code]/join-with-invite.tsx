'use client';

import { useActionState } from 'react';

import { Alert, Button } from '@/components/ui';

import { redeemInviteAction, type RoomActionState } from '../../(app)/app/room-actions';

export function JoinWithInvite({ code, name }: { code: string; name: string }) {
  const [state, action, pending] = useActionState<RoomActionState, FormData>(
    redeemInviteAction,
    {},
  );
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="code" value={code} />
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <Button type="submit" disabled={pending}>
        {pending ? 'Joining…' : `Join #${name}`}
      </Button>
    </form>
  );
}
