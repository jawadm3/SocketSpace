import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  getConnectionProfile,
  getPersonRows,
  getPublicUsers,
  getRoomForViewer,
  inviteList,
  listRoomBans,
  listRoomMembers,
} from '@socketspace/db';
import { decide, type Actor, type ConversationContext } from '@socketspace/shared/authz';

import { getDb } from '@/server/db';
import { requireAppUser } from '@/server/session';

import {
  BanList,
  DeleteRoomForm,
  InviteSection,
  MemberManager,
  RoomDetailsForm,
  type InviteRow,
  type ManagedMember,
} from './settings-forms';

export const metadata: Metadata = { title: 'Room settings' };

/**
 * Room settings for owners and moderators (ROOM-03 to ROOM-06). Every button shown here is one
 * the shared authorisation rules allow for this viewer and that person; the server checks again
 * when it is pressed.
 */
export default async function RoomSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user } = await requireAppUser(`/app/r/${slug}/settings`);
  const db = getDb();
  const view = await getRoomForViewer(db, user.id, slug);
  const profile = await getConnectionProfile(db, user.id);
  if (!view || !profile) notFound();
  const { room, membership } = view;
  const isAdmin = profile.role === 'admin';
  const canSee = isAdmin || membership?.role === 'owner' || membership?.role === 'moderator';
  if (!canSee) notFound();

  const actor: Actor = {
    id: user.id,
    role: profile.role,
    status: profile.status,
    isGuest: profile.isAnonymous,
    emailVerified: profile.emailVerified,
    onboarded: profile.onboarded,
  };
  const context: ConversationContext = {
    kind: 'room',
    visibility: room.visibility,
    membership: membership ? { role: membership.role, muted: membership.muted } : null,
    bannedHere: false,
  };

  const [members, bans, invites] = await Promise.all([
    listRoomMembers(db, room.id, { limit: 500 }),
    listRoomBans(db, room.id),
    inviteList(db, user.id, room.id),
  ]);
  const ids = [
    ...new Set([
      ...members.map((m) => m.userId),
      ...bans.map((b) => b.userId),
      ...(invites.ok ? invites.invites.flatMap((i) => (i.createdBy ? [i.createdBy] : [])) : []),
    ]),
  ];
  const [people, rows] = await Promise.all([
    getPublicUsers(db, user.id, ids, 'chat'),
    getPersonRows(db, ids),
  ]);
  const personById = new Map(people.map((p) => [p.id, p]));
  const adminIds = new Set(rows.filter((r) => r.role === 'admin').map((r) => r.id));

  const managed: ManagedMember[] = members.map((member) => {
    const target = {
      userId: member.userId,
      role: member.role,
      isAdmin: adminIds.has(member.userId),
    };
    const allowed = (action: 'member.mute' | 'member.remove' | 'member.ban' | 'member.set_role') =>
      decide(actor, context, action, target).allowed;
    return {
      person: personById.get(member.userId) ?? {
        id: member.userId,
        nickname: 'Unknown',
        avatar: null,
      },
      role: member.role,
      mutedUntil: member.muted ? (member.mutedUntil?.toISOString() ?? null) : null,
      isSelf: member.userId === user.id,
      can: {
        setRole: allowed('member.set_role') && member.role !== 'owner',
        transfer: membership?.role === 'owner' && member.userId !== user.id,
        mute: allowed('member.mute'),
        remove: allowed('member.remove'),
        ban: allowed('member.ban'),
      },
    };
  });

  const inviteRows: InviteRow[] = invites.ok
    ? invites.invites.map((invite) => {
        const status = invite.revokedAt
          ? 'Cancelled'
          : invite.expired
            ? 'Expired'
            : invite.maxUses !== null && invite.useCount >= invite.maxUses
              ? 'Used up'
              : 'Active';
        return {
          id: invite.id,
          createdBy: invite.createdBy ? (personById.get(invite.createdBy)?.nickname ?? '') : '',
          createdAt: invite.createdAt.toISOString(),
          expiresAt: invite.expiresAt?.toISOString() ?? null,
          uses:
            invite.maxUses === null
              ? `${String(invite.useCount)} used`
              : `${String(invite.useCount)} of ${String(invite.maxUses)} used`,
          status,
        };
      })
    : [];

  const isOwner = isAdmin || membership?.role === 'owner';

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8">
      <header>
        <p className="text-sm">
          <Link href={`/app/r/${room.slug}`} className="font-semibold text-accent underline">
            ← Back to #{room.name}
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight">Room settings</h1>
        <p className="mt-1 text-sm text-ink-2">
          {room.visibility === 'private' ? 'Private room' : 'Public room'} · /app/r/{room.slug}
        </p>
      </header>

      {isOwner ? (
        <RoomDetailsForm conversationId={room.id} name={room.name} topic={room.topic} />
      ) : null}

      <InviteSection conversationId={room.id} invites={inviteRows} />

      <MemberManager conversationId={room.id} members={managed} />

      <BanList
        conversationId={room.id}
        bans={bans.map((ban) => ({
          person: personById.get(ban.userId) ?? {
            id: ban.userId,
            nickname: 'Unknown',
            avatar: null,
          },
          reason: ban.reason,
          expiresAt: ban.expiresAt?.toISOString() ?? null,
        }))}
      />

      {isOwner ? <DeleteRoomForm conversationId={room.id} name={room.name} /> : null}
    </main>
  );
}
