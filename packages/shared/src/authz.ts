/**
 * Authorisation: one module answers "may this person do this action here?" for the web app and the
 * realtime server alike (security.md 3.3). Deny by default: an action is allowed only when a rule
 * below says so. Every role × action combination is covered by a table-driven test (authz.test.ts).
 *
 * The database re-checks the decisive conditions inside the write itself (for example membership
 * in `sendMessage`), so a decision made a moment earlier cannot be used to slip past a change.
 */
import type {
  ConversationKind,
  ConversationVisibility,
  MemberRole,
  UserRole,
  UserStatus,
} from './domain';

export interface Actor {
  id: string;
  role: UserRole;
  status: UserStatus;
  /** Guest (anonymous) account: random mode only (D-025). */
  isGuest: boolean;
  emailVerified: boolean;
  onboarded: boolean;
}

export interface ConversationContext {
  kind: ConversationKind;
  visibility: ConversationVisibility;
  /** The actor's membership, or `null` if they are not a member. */
  membership: { role: MemberRole; muted: boolean } | null;
  /** The actor has an active room ban here. */
  bannedHere: boolean;
}

export type ConversationAction =
  | 'conversation.read'
  | 'room.join'
  | 'room.join_with_invite'
  | 'room.update'
  | 'room.delete'
  | 'room.invite'
  | 'message.send'
  | 'message.react'
  | 'message.edit_own'
  | 'message.delete_own'
  | 'message.delete_any'
  | 'member.mute'
  | 'member.ban'
  | 'member.remove'
  | 'member.set_role';

export type GlobalAction =
  'admin.access' | 'room.create' | 'dm.start' | 'report.create' | 'random.join';

/** The person an action is aimed at (for moderation actions and deleting someone else's message). */
export interface Target {
  userId: string;
  /** Their role in this conversation, or `null` if they are not (or no longer) a member. */
  role: MemberRole | null;
  /** They are a site administrator. */
  isAdmin?: boolean;
}

export type DenyReason =
  | 'inactive'
  | 'guest'
  | 'unverified'
  | 'not_onboarded'
  | 'not_admin'
  | 'not_member'
  | 'already_member'
  | 'private'
  | 'room_banned'
  | 'muted'
  | 'dm'
  | 'role'
  | 'target_rank'
  | 'self'
  | 'no_target';

export type Decision = { allowed: true } | { allowed: false; reason: DenyReason };

const ALLOW: Decision = { allowed: true };
const deny = (reason: DenyReason): Decision => ({ allowed: false, reason });

/** Higher rank can act on lower rank. Site admins outrank every room role. */
const RANK: Record<MemberRole, number> = { member: 1, moderator: 2, owner: 3 };
const ADMIN_RANK = 4;

/** Actions that change something; unverified accounts may only read (journey J1). */
const WRITE_ACTIONS: ReadonlySet<ConversationAction | GlobalAction> = new Set([
  'room.join',
  'room.join_with_invite',
  'room.update',
  'room.delete',
  'room.invite',
  'message.send',
  'message.react',
  'message.edit_own',
  'message.delete_any',
  'member.mute',
  'member.ban',
  'member.remove',
  'member.set_role',
  'room.create',
  'dm.start',
]);

/** Checks every community action needs: an active, non-guest, onboarded account. */
function accountGate(actor: Actor, action: ConversationAction | GlobalAction): Decision | null {
  if (actor.status !== 'active') return deny('inactive');
  if (actor.isGuest) return deny('guest');
  if (!actor.onboarded) return deny('not_onboarded');
  if (WRITE_ACTIONS.has(action) && !actor.emailVerified) return deny('unverified');
  return null;
}

export function decideGlobal(actor: Actor, action: GlobalAction): Decision {
  switch (action) {
    case 'random.join':
      // Guests are welcome in random mode (D-025). The 18+ gate, terms version and random-mode
      // timeouts are checked by the random-mode handlers (Stage E).
      return actor.status === 'active' ? ALLOW : deny('inactive');
    case 'report.create':
      // Anyone active may report, including guests (random-mode reports).
      return actor.status === 'active' ? ALLOW : deny('inactive');
    case 'admin.access':
      if (actor.status !== 'active') return deny('inactive');
      return actor.role === 'admin' && !actor.isGuest ? ALLOW : deny('not_admin');
    case 'room.create':
    case 'dm.start':
      return accountGate(actor, action) ?? ALLOW;
  }
}

export function decide(
  actor: Actor,
  conversation: ConversationContext,
  action: ConversationAction,
  target?: Target,
): Decision {
  const gate = accountGate(actor, action);
  if (gate) return gate;

  const isAdmin = actor.role === 'admin';
  const member = conversation.membership;
  const memberRank = member ? RANK[member.role] : 0;
  const rank = isAdmin ? ADMIN_RANK : memberRank;

  if (conversation.bannedHere && !isAdmin) return deny('room_banned');

  // Room management makes no sense for a DM.
  const roomOnly: ConversationAction[] = [
    'room.join',
    'room.join_with_invite',
    'room.update',
    'room.delete',
    'room.invite',
    'member.mute',
    'member.ban',
    'member.remove',
    'member.set_role',
  ];
  if (conversation.kind === 'dm' && roomOnly.includes(action)) return deny('dm');

  switch (action) {
    case 'conversation.read':
      if (member || isAdmin) return ALLOW;
      return conversation.kind === 'room' && conversation.visibility === 'public'
        ? ALLOW
        : deny('private');

    case 'room.join':
      if (member) return deny('already_member');
      return conversation.visibility === 'public' ? ALLOW : deny('private');

    case 'room.join_with_invite':
      // The invite itself (expiry, uses, revocation) is checked where it is redeemed.
      return member ? deny('already_member') : ALLOW;

    case 'room.update':
    case 'room.delete':
      return rank >= RANK.owner ? ALLOW : deny(member || isAdmin ? 'role' : 'not_member');

    case 'room.invite':
      if (!member && !isAdmin) return deny('not_member');
      if (conversation.visibility === 'public') return ALLOW;
      return rank >= RANK.moderator ? ALLOW : deny('role');

    case 'message.send':
    case 'message.react':
    case 'message.edit_own':
      // Taking part needs membership, even for site admins.
      if (!member) return deny('not_member');
      return member.muted ? deny('muted') : ALLOW;

    case 'message.delete_own':
      // Removing your own words is allowed even while muted.
      return member ? ALLOW : deny('not_member');

    case 'message.delete_any':
      if (!target) return deny('no_target');
      if (target.userId === actor.id) return member ? ALLOW : deny('not_member');
      // DMs have no room moderators: only site admins remove other people's DM messages.
      if (conversation.kind === 'dm' && !isAdmin) return deny('dm');
      return outranks(rank, target) ? ALLOW : deny(rank >= RANK.moderator ? 'target_rank' : 'role');

    case 'member.mute':
    case 'member.ban':
    case 'member.remove':
      if (!target) return deny('no_target');
      if (target.userId === actor.id) return deny('self');
      if (rank < RANK.moderator) return deny(member ? 'role' : 'not_member');
      return outranks(rank, target) ? ALLOW : deny('target_rank');

    case 'member.set_role':
      // Promoting to or demoting from moderator. Ownership transfer is a separate flow.
      if (!target) return deny('no_target');
      if (target.userId === actor.id) return deny('self');
      if (rank < RANK.owner) return deny(member ? 'role' : 'not_member');
      if (target.role === null) return deny('not_member');
      return outranks(rank, target) ? ALLOW : deny('target_rank');
  }
}

function outranks(actorRank: number, target: Target): boolean {
  const targetRank = target.isAdmin ? ADMIN_RANK : target.role ? RANK[target.role] : 0;
  return actorRank > targetRank;
}
