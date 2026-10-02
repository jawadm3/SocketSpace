/**
 * Plain-English wording for room refusals, shared by every room page and action.
 */
import 'server-only';

import type { RoomRefusal } from '@socketspace/db';
import type { DenyReason } from '@socketspace/shared/authz';

/** "in 5 minutes", "in 3 hours", "in 2 days": server pages do not know the reader's time zone. */
export function timeLeft(until: Date, now = new Date()): string {
  const minutes = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000));
  if (minutes < 60) return `in ${String(minutes)} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${String(hours)} hour${hours === 1 ? '' : 's'}`;
  return `in ${String(Math.round(hours / 24))} days`;
}

const DENIED: Record<DenyReason, string> = {
  inactive: 'Your account is suspended or closed.',
  guest: 'Guest accounts can only use random mode. Create an account to join rooms.',
  unverified: 'Confirm your email address first: we sent you a link.',
  not_onboarded: 'Finish setting up your profile first.',
  not_admin: 'Only site administrators can do that.',
  not_member: 'You are not a member of this room.',
  already_member: 'You are already in this room.',
  private: 'This room is private: you need an invite.',
  room_banned: 'You are banned from this room.',
  muted: 'You are muted in this room.',
  dm: 'That is not possible in a direct message.',
  role: 'Your role in this room does not allow that.',
  target_rank: 'You cannot do that to someone with the same or a higher role.',
  self: 'You cannot do that to yourself.',
  no_target: 'Choose a person first.',
};

export function roomRefusalText(refusal: RoomRefusal): string {
  switch (refusal.reason) {
    case 'not_found':
      return 'That room or person could not be found.';
    case 'denied':
      return DENIED[refusal.deny];
    case 'room_banned':
      return refusal.until
        ? `You are banned from this room. The ban ends ${timeLeft(refusal.until)}.`
        : 'You are banned from this room.';
    case 'slug_taken':
      return 'That address is taken. Try another.';
    case 'last_owner':
      return 'You are the only owner. Hand the room to someone else, or delete it, before leaving.';
    case 'invite_invalid':
      return {
        not_found: 'This invite link is not valid.',
        expired: 'This invite has expired. Ask for a new one.',
        revoked: 'This invite was cancelled. Ask for a new one.',
        used_up: 'This invite has been used up. Ask for a new one.',
      }[refusal.problem];
  }
}
