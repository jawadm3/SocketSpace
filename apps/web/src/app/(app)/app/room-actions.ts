'use server';

/**
 * Server actions for rooms (ROOM-01 to ROOM-06). Each one: checks who is signed in, validates the
 * form with the shared schemas, calls the database function (which decides and writes in one
 * transaction), and on success tells the realtime server so open tabs update at once.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import {
  inviteCreate,
  inviteRedeem,
  inviteRevoke,
  roomBanUser,
  roomCreate,
  roomDelete,
  roomJoin,
  roomLeave,
  roomMute,
  roomRemove,
  roomSetRole,
  roomTransferOwnership,
  roomUnbanUser,
  roomUnmute,
  roomUpdate,
  type RoomRefusal,
} from '@socketspace/db';
import { uuid } from '@socketspace/shared/primitives';
import {
  createInviteSchema,
  createRoomSchema,
  INVITE_EXPIRY_CHOICES,
  INVITE_USE_CHOICES,
  inviteCodeSchema,
  ROOM_BAN_CHOICES,
  ROOM_MUTE_CHOICES,
  roomBanSchema,
  roomMuteSchema,
  roomRemoveSchema,
  roomRoleSchema,
  updateRoomSchema,
} from '@socketspace/shared/rooms';

import { formText } from '@/lib/forms';
import { getDb } from '@/server/db';
import { getWebEnv } from '@/server/env';
import { getNotifier } from '@/server/notifier';
import { roomRefusalText } from '@/server/rooms';
import { getCurrentSession } from '@/server/session';

export interface RoomActionState {
  message?: string;
  error?: string;
  fieldErrors?: Partial<Record<string, string>>;
  values?: Record<string, string>;
  /** A newly created invite link: shown once, because only its hash is stored. */
  inviteUrl?: string;
}

/** The signed-in, set-up person, or a redirect to where they need to go first. */
async function actorId(): Promise<string> {
  const current = await getCurrentSession();
  if (!current) redirect('/sign-in');
  if (current.user.isAnonymous) redirect('/sign-in?guest=1');
  if (!current.user.onboardedAt) redirect('/onboarding');
  return current.user.id;
}

const failure = (refusal: RoomRefusal): RoomActionState => ({ error: roomRefusalText(refusal) });
const invalid: RoomActionState = {
  error: 'Something in the form was not valid. Please try again.',
};

function refreshApp() {
  revalidatePath('/app', 'layout');
}

// Creating, joining, leaving -------------------------------------------------------------------

export async function createRoomAction(
  _previous: RoomActionState,
  form: FormData,
): Promise<RoomActionState> {
  const actor = await actorId();
  const values = {
    name: formText(form, 'name'),
    slug: formText(form, 'slug'),
    topic: formText(form, 'topic'),
    visibility: formText(form, 'visibility') || 'public',
  };
  const parsed = createRoomSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? 'form');
      fieldErrors[field] ??= issue.message;
    }
    return { values, fieldErrors };
  }
  const result = await roomCreate(getDb(), actor, parsed.data);
  if (!result.ok) {
    return result.reason === 'slug_taken'
      ? { values, fieldErrors: { slug: roomRefusalText(result) } }
      : { values, ...failure(result) };
  }
  await getNotifier().notify({
    type: 'member.added',
    conversationId: result.room.id,
    userId: actor,
    role: 'owner',
  });
  refreshApp();
  redirect(`/app/r/${result.room.slug}`);
}

export async function joinRoomAction(form: FormData): Promise<void> {
  const actor = await actorId();
  const conversationId = uuid.safeParse(formText(form, 'conversationId'));
  if (!conversationId.success) return;
  const result = await roomJoin(getDb(), actor, conversationId.data);
  if (!result.ok) {
    redirect(`/app/explore?error=${encodeURIComponent(roomRefusalText(result))}`);
  }
  if (result.added) {
    await getNotifier().notify({
      type: 'member.added',
      conversationId: result.room.id,
      userId: actor,
      role: 'member',
    });
  }
  refreshApp();
  redirect(`/app/r/${result.room.slug}`);
}

export async function leaveRoomAction(
  _previous: RoomActionState,
  form: FormData,
): Promise<RoomActionState> {
  const actor = await actorId();
  const conversationId = uuid.safeParse(formText(form, 'conversationId'));
  if (!conversationId.success) return invalid;
  const result = await roomLeave(getDb(), actor, conversationId.data);
  if (!result.ok) return failure(result);
  if (result.removed) {
    await getNotifier().notify({
      type: 'member.removed',
      conversationId: conversationId.data,
      userId: actor,
      cause: 'left',
    });
  }
  refreshApp();
  redirect('/app');
}

export async function redeemInviteAction(
  _previous: RoomActionState,
  form: FormData,
): Promise<RoomActionState> {
  const actor = await actorId();
  const code = inviteCodeSchema.safeParse(formText(form, 'code'));
  if (!code.success) return { error: 'This invite link is not valid.' };
  const result = await inviteRedeem(getDb(), actor, code.data);
  if (!result.ok) return failure(result);
  if (result.added) {
    await getNotifier().notify({
      type: 'member.added',
      conversationId: result.room.id,
      userId: actor,
      role: 'member',
    });
  }
  refreshApp();
  redirect(`/app/r/${result.room.slug}`);
}

// Settings -------------------------------------------------------------------------------------------

export async function updateRoomAction(
  _previous: RoomActionState,
  form: FormData,
): Promise<RoomActionState> {
  const actor = await actorId();
  const conversationId = uuid.safeParse(formText(form, 'conversationId'));
  const values = { name: formText(form, 'name'), topic: formText(form, 'topic') };
  const parsed = updateRoomSchema.safeParse(values);
  if (!conversationId.success) return invalid;
  if (!parsed.success) {
    return { values, error: parsed.error.issues[0]?.message ?? invalid.error };
  }
  const result = await roomUpdate(getDb(), actor, conversationId.data, parsed.data);
  if (!result.ok) return { values, ...failure(result) };
  await getNotifier().notify({ type: 'conversation.updated', conversationId: result.room.id });
  refreshApp();
  return { message: 'Saved.' };
}

export async function deleteRoomAction(
  _previous: RoomActionState,
  form: FormData,
): Promise<RoomActionState> {
  const actor = await actorId();
  const conversationId = uuid.safeParse(formText(form, 'conversationId'));
  if (!conversationId.success) return invalid;
  if (formText(form, 'confirm') !== 'delete') {
    return { error: 'Type "delete" to confirm.' };
  }
  const result = await roomDelete(getDb(), actor, conversationId.data);
  if (!result.ok) return failure(result);
  await getNotifier().notify({ type: 'conversation.deleted', conversationId: conversationId.data });
  refreshApp();
  redirect('/app');
}

// Roles -------------------------------------------------------------------------------------------------

export async function setRoleAction(
  _previous: RoomActionState,
  form: FormData,
): Promise<RoomActionState> {
  const actor = await actorId();
  const parsed = roomRoleSchema.safeParse({
    conversationId: formText(form, 'conversationId'),
    userId: formText(form, 'userId'),
    role: formText(form, 'role'),
  });
  if (!parsed.success) return invalid;
  const { conversationId, userId, role } = parsed.data;
  const result = await roomSetRole(getDb(), actor, conversationId, userId, role);
  if (!result.ok) return failure(result);
  if (result.changed) {
    await getNotifier().notify({ type: 'member.role_changed', conversationId, userId, role });
  }
  refreshApp();
  return {
    message: role === 'moderator' ? 'They are now a moderator.' : 'Moderator role removed.',
  };
}

export async function transferOwnershipAction(
  _previous: RoomActionState,
  form: FormData,
): Promise<RoomActionState> {
  const actor = await actorId();
  const conversationId = uuid.safeParse(formText(form, 'conversationId'));
  const userId = uuid.safeParse(formText(form, 'userId'));
  if (!conversationId.success || !userId.success) return invalid;
  const result = await roomTransferOwnership(getDb(), actor, conversationId.data, userId.data);
  if (!result.ok) return failure(result);
  const notifier = getNotifier();
  await notifier.notify({
    type: 'member.role_changed',
    conversationId: conversationId.data,
    userId: userId.data,
    role: 'owner',
  });
  await notifier.notify({
    type: 'member.role_changed',
    conversationId: conversationId.data,
    userId: actor,
    role: 'moderator',
  });
  refreshApp();
  return { message: 'Ownership transferred. You are now a moderator.' };
}

// Room moderation ----------------------------------------------------------------------------------------

export async function muteMemberAction(
  _previous: RoomActionState,
  form: FormData,
): Promise<RoomActionState> {
  const actor = await actorId();
  const parsed = roomMuteSchema.safeParse({
    conversationId: formText(form, 'conversationId'),
    userId: formText(form, 'userId'),
    duration: formText(form, 'duration'),
    reason: formText(form, 'reason'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? invalid.error };
  const { conversationId, userId, duration, reason } = parsed.data;
  const result = await roomMute(
    getDb(),
    actor,
    conversationId,
    userId,
    ROOM_MUTE_CHOICES[duration],
    reason,
  );
  if (!result.ok) return failure(result);
  await getNotifier().notify({
    type: 'member.muted',
    conversationId,
    userId,
    until: result.until.toISOString(),
    reason,
  });
  refreshApp();
  return { message: 'Muted.' };
}

export async function unmuteMemberAction(
  _previous: RoomActionState,
  form: FormData,
): Promise<RoomActionState> {
  const actor = await actorId();
  const conversationId = uuid.safeParse(formText(form, 'conversationId'));
  const userId = uuid.safeParse(formText(form, 'userId'));
  if (!conversationId.success || !userId.success) return invalid;
  const result = await roomUnmute(getDb(), actor, conversationId.data, userId.data);
  if (!result.ok) return failure(result);
  if (result.changed) {
    await getNotifier().notify({
      type: 'member.muted',
      conversationId: conversationId.data,
      userId: userId.data,
      until: null,
      reason: 'Mute lifted',
    });
  }
  refreshApp();
  return { message: 'Mute lifted.' };
}

export async function removeMemberAction(
  _previous: RoomActionState,
  form: FormData,
): Promise<RoomActionState> {
  const actor = await actorId();
  const parsed = roomRemoveSchema.safeParse({
    conversationId: formText(form, 'conversationId'),
    userId: formText(form, 'userId'),
    reason: formText(form, 'reason'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? invalid.error };
  const { conversationId, userId, reason } = parsed.data;
  const result = await roomRemove(getDb(), actor, conversationId, userId, reason);
  if (!result.ok) return failure(result);
  await getNotifier().notify({
    type: 'member.removed',
    conversationId,
    userId,
    cause: 'removed',
    reason,
  });
  refreshApp();
  return { message: 'Removed from the room.' };
}

export async function banMemberAction(
  _previous: RoomActionState,
  form: FormData,
): Promise<RoomActionState> {
  const actor = await actorId();
  const parsed = roomBanSchema.safeParse({
    conversationId: formText(form, 'conversationId'),
    userId: formText(form, 'userId'),
    duration: formText(form, 'duration'),
    reason: formText(form, 'reason'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? invalid.error };
  const { conversationId, userId, duration, reason } = parsed.data;
  const result = await roomBanUser(
    getDb(),
    actor,
    conversationId,
    userId,
    ROOM_BAN_CHOICES[duration],
    reason,
  );
  if (!result.ok) return failure(result);
  if (result.wasMember) {
    await getNotifier().notify({
      type: 'member.removed',
      conversationId,
      userId,
      cause: 'banned',
      reason,
      until: result.until?.toISOString() ?? null,
    });
  }
  refreshApp();
  return { message: 'Banned from the room.' };
}

export async function unbanMemberAction(
  _previous: RoomActionState,
  form: FormData,
): Promise<RoomActionState> {
  const actor = await actorId();
  const conversationId = uuid.safeParse(formText(form, 'conversationId'));
  const userId = uuid.safeParse(formText(form, 'userId'));
  if (!conversationId.success || !userId.success) return invalid;
  const result = await roomUnbanUser(getDb(), actor, conversationId.data, userId.data);
  if (!result.ok) return failure(result);
  refreshApp();
  return { message: 'Ban lifted.' };
}

// Invites ----------------------------------------------------------------------------------------------------

export async function createInviteAction(
  _previous: RoomActionState,
  form: FormData,
): Promise<RoomActionState> {
  const actor = await actorId();
  const parsed = createInviteSchema.safeParse({
    conversationId: formText(form, 'conversationId'),
    expiresIn: formText(form, 'expiresIn'),
    maxUses: formText(form, 'maxUses'),
  });
  if (!parsed.success) return invalid;
  const { conversationId, expiresIn, maxUses } = parsed.data;
  const result = await inviteCreate(getDb(), actor, conversationId, {
    expiresInMs: INVITE_EXPIRY_CHOICES[expiresIn],
    maxUses: INVITE_USE_CHOICES[maxUses],
  });
  if (!result.ok) return failure(result);
  refreshApp();
  const origin = new URL(getWebEnv().BETTER_AUTH_URL).origin;
  return {
    message: 'Invite created. Copy the link now: it is not shown again.',
    inviteUrl: `${origin}/invite/${result.code}`,
  };
}

export async function revokeInviteAction(
  _previous: RoomActionState,
  form: FormData,
): Promise<RoomActionState> {
  const actor = await actorId();
  const inviteId = uuid.safeParse(formText(form, 'inviteId'));
  if (!inviteId.success) return invalid;
  const result = await inviteRevoke(getDb(), actor, inviteId.data);
  if (!result.ok) return failure(result);
  refreshApp();
  return { message: 'Invite cancelled.' };
}
