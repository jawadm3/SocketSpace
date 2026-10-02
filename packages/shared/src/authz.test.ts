/**
 * Table-driven authorisation tests (requirement SEC-13): every kind of actor against every action,
 * in a public room, a private room and a DM. Each table row lists exactly the actions that actor
 * may take; every other action must be denied.
 */
import { describe, expect, it } from 'vitest';

import {
  decide,
  decideGlobal,
  type Actor,
  type ConversationAction,
  type ConversationContext,
  type GlobalAction,
  type Target,
} from './authz';
import type { ConversationKind, ConversationVisibility, MemberRole } from './domain';

const ACTOR_ID = '00000000-0000-7000-8000-000000000001';

const ALL_ACTIONS: ConversationAction[] = [
  'conversation.read',
  'room.join',
  'room.join_with_invite',
  'room.update',
  'room.delete',
  'room.invite',
  'message.send',
  'message.react',
  'message.edit_own',
  'message.delete_own',
  'message.delete_any',
  'member.mute',
  'member.ban',
  'member.remove',
  'member.set_role',
];

interface Persona {
  actor: Partial<Actor>;
  membership: MemberRole | null;
  muted?: boolean;
  bannedHere?: boolean;
}

const PERSONAS = {
  guest: { actor: { isGuest: true, emailVerified: false, onboarded: false }, membership: null },
  suspended: { actor: { status: 'suspended' }, membership: 'member' },
  banned: { actor: { status: 'banned' }, membership: 'member' },
  notOnboarded: { actor: { onboarded: false }, membership: null },
  unverifiedMember: { actor: { emailVerified: false }, membership: 'member' },
  outsider: { actor: {}, membership: null },
  member: { actor: {}, membership: 'member' },
  mutedMember: { actor: {}, membership: 'member', muted: true },
  roomBanned: { actor: {}, membership: null, bannedHere: true },
  moderator: { actor: {}, membership: 'moderator' },
  owner: { actor: {}, membership: 'owner' },
  adminOutsider: { actor: { role: 'admin' }, membership: null },
} satisfies Record<string, Persona>;

type PersonaName = keyof typeof PERSONAS;

function actorOf(persona: Persona): Actor {
  return {
    id: ACTOR_ID,
    role: 'user',
    status: 'active',
    isGuest: false,
    emailVerified: true,
    onboarded: true,
    ...persona.actor,
  };
}

function contextOf(
  persona: Persona,
  kind: ConversationKind,
  visibility: ConversationVisibility,
): ConversationContext {
  return {
    kind,
    visibility,
    membership: persona.membership
      ? { role: persona.membership, muted: persona.muted ?? false }
      : null,
    bannedHere: persona.bannedHere ?? false,
  };
}

/**
 * The default target for actions that need one: an ordinary member who is someone else.
 * (Rank rules between moderators, owners and admins are tested separately below.)
 */
const MEMBER_TARGET: Target = { userId: '00000000-0000-7000-8000-000000000002', role: 'member' };

function allowedActions(
  name: PersonaName,
  kind: ConversationKind,
  visibility: ConversationVisibility,
): ConversationAction[] {
  const persona = PERSONAS[name];
  return ALL_ACTIONS.filter(
    (action) =>
      decide(actorOf(persona), contextOf(persona, kind, visibility), action, MEMBER_TARGET).allowed,
  );
}

const MEMBER_ACTIONS: ConversationAction[] = [
  'conversation.read',
  'message.send',
  'message.react',
  'message.edit_own',
  'message.delete_own',
];
const MODERATION: ConversationAction[] = [
  'message.delete_any',
  'member.mute',
  'member.ban',
  'member.remove',
];

const PUBLIC_ROOM: Record<PersonaName, ConversationAction[]> = {
  guest: [],
  suspended: [],
  banned: [],
  notOnboarded: [],
  // Unverified accounts are read-only (journey J1).
  unverifiedMember: ['conversation.read', 'message.delete_own'],
  outsider: ['conversation.read', 'room.join', 'room.join_with_invite'],
  member: [...MEMBER_ACTIONS, 'room.invite'],
  mutedMember: ['conversation.read', 'room.invite', 'message.delete_own'],
  roomBanned: [],
  moderator: [...MEMBER_ACTIONS, 'room.invite', ...MODERATION],
  owner: [
    ...MEMBER_ACTIONS,
    'room.update',
    'room.delete',
    'room.invite',
    ...MODERATION,
    'member.set_role',
  ],
  // Admins can moderate anywhere, but must join to take part in the conversation.
  adminOutsider: [
    'conversation.read',
    'room.join',
    'room.join_with_invite',
    'room.update',
    'room.delete',
    'room.invite',
    ...MODERATION,
    'member.set_role',
  ],
};

const PRIVATE_ROOM: Record<PersonaName, ConversationAction[]> = {
  ...PUBLIC_ROOM,
  outsider: ['room.join_with_invite'],
  // In private rooms only moderators and owners create invites.
  member: MEMBER_ACTIONS,
  mutedMember: ['conversation.read', 'message.delete_own'],
  adminOutsider: PUBLIC_ROOM.adminOutsider.filter((a) => a !== 'room.join'),
};

const DM: Record<PersonaName, ConversationAction[]> = {
  guest: [],
  suspended: [],
  banned: [],
  notOnboarded: [],
  unverifiedMember: ['conversation.read', 'message.delete_own'],
  outsider: [],
  member: MEMBER_ACTIONS,
  mutedMember: ['conversation.read', 'message.delete_own'],
  roomBanned: [],
  moderator: MEMBER_ACTIONS,
  owner: MEMBER_ACTIONS,
  adminOutsider: ['conversation.read', 'message.delete_any'],
};

const sorted = (list: readonly string[]) => [...list].sort();

describe('decide: public room', () => {
  it.each(Object.keys(PUBLIC_ROOM) as PersonaName[])('%s', (name) => {
    expect(sorted(allowedActions(name, 'room', 'public'))).toEqual(sorted(PUBLIC_ROOM[name]));
  });
});

describe('decide: private room', () => {
  it.each(Object.keys(PRIVATE_ROOM) as PersonaName[])('%s', (name) => {
    expect(sorted(allowedActions(name, 'room', 'private'))).toEqual(sorted(PRIVATE_ROOM[name]));
  });
});

describe('decide: direct message', () => {
  it.each(Object.keys(DM) as PersonaName[])('%s', (name) => {
    expect(sorted(allowedActions(name, 'dm', 'private'))).toEqual(sorted(DM[name]));
  });
});

describe('decide: rank rules for moderation', () => {
  const ROLES = [null, 'member', 'moderator', 'owner'] as const;
  const ACTING = ['moderator', 'owner', 'admin'] as const;

  // Rows: who acts. Columns: target's role (null = not a member), then a site admin target.
  const CAN_MODERATE: Record<(typeof ACTING)[number], boolean[]> = {
    moderator: [true, true, false, false, false],
    owner: [true, true, true, false, false],
    admin: [true, true, true, true, false],
  };

  for (const acting of ACTING) {
    it(`${acting} can only mute, ban, remove or delete messages of people below them`, () => {
      const actor: Actor = {
        id: ACTOR_ID,
        role: acting === 'admin' ? 'admin' : 'user',
        status: 'active',
        isGuest: false,
        emailVerified: true,
        onboarded: true,
      };
      const context: ConversationContext = {
        kind: 'room',
        visibility: 'public',
        membership: acting === 'admin' ? null : { role: acting, muted: false },
        bannedHere: false,
      };
      const targets: Target[] = [
        ...ROLES.map((role) => ({ userId: MEMBER_TARGET.userId, role })),
        { userId: MEMBER_TARGET.userId, role: 'member', isAdmin: true },
      ];
      for (const action of [
        'member.mute',
        'member.ban',
        'member.remove',
        'message.delete_any',
      ] as const) {
        const results = targets.map((target) => decide(actor, context, action, target).allowed);
        expect({ action, results }).toEqual({ action, results: CAN_MODERATE[acting] });
      }
    });
  }

  it('never lets anyone mute, ban or remove themselves', () => {
    const actor: Actor = {
      id: ACTOR_ID,
      role: 'admin',
      status: 'active',
      isGuest: false,
      emailVerified: true,
      onboarded: true,
    };
    const context: ConversationContext = {
      kind: 'room',
      visibility: 'public',
      membership: { role: 'owner', muted: false },
      bannedHere: false,
    };
    for (const action of [
      'member.mute',
      'member.ban',
      'member.remove',
      'member.set_role',
    ] as const) {
      expect(decide(actor, context, action, { userId: ACTOR_ID, role: 'owner' })).toEqual({
        allowed: false,
        reason: 'self',
      });
    }
  });

  it('lets members delete their own messages through delete_any, but not other people’s', () => {
    const actor: Actor = {
      id: ACTOR_ID,
      role: 'user',
      status: 'active',
      isGuest: false,
      emailVerified: true,
      onboarded: true,
    };
    const context: ConversationContext = {
      kind: 'room',
      visibility: 'public',
      membership: { role: 'member', muted: false },
      bannedHere: false,
    };
    expect(
      decide(actor, context, 'message.delete_any', { userId: ACTOR_ID, role: 'member' }).allowed,
    ).toBe(true);
    expect(decide(actor, context, 'message.delete_any', MEMBER_TARGET)).toEqual({
      allowed: false,
      reason: 'role',
    });
  });

  it('only lets owners and admins change roles, and only of current members', () => {
    const owner: Actor = {
      id: ACTOR_ID,
      role: 'user',
      status: 'active',
      isGuest: false,
      emailVerified: true,
      onboarded: true,
    };
    const ctx = (role: MemberRole): ConversationContext => ({
      kind: 'room',
      visibility: 'public',
      membership: { role, muted: false },
      bannedHere: false,
    });
    expect(decide(owner, ctx('owner'), 'member.set_role', MEMBER_TARGET).allowed).toBe(true);
    expect(
      decide(owner, ctx('owner'), 'member.set_role', { ...MEMBER_TARGET, role: null }),
    ).toEqual({ allowed: false, reason: 'not_member' });
    expect(decide(owner, ctx('moderator'), 'member.set_role', MEMBER_TARGET)).toEqual({
      allowed: false,
      reason: 'role',
    });
  });

  it('denies target actions without a target', () => {
    const actor: Actor = {
      id: ACTOR_ID,
      role: 'admin',
      status: 'active',
      isGuest: false,
      emailVerified: true,
      onboarded: true,
    };
    const context: ConversationContext = {
      kind: 'room',
      visibility: 'public',
      membership: null,
      bannedHere: false,
    };
    expect(decide(actor, context, 'member.ban')).toEqual({ allowed: false, reason: 'no_target' });
  });
});

describe('decide: reasons', () => {
  it('explains the first reason an action is refused', () => {
    const base: Actor = {
      id: ACTOR_ID,
      role: 'user',
      status: 'active',
      isGuest: false,
      emailVerified: true,
      onboarded: true,
    };
    const room: ConversationContext = {
      kind: 'room',
      visibility: 'private',
      membership: null,
      bannedHere: false,
    };
    expect(decide({ ...base, status: 'banned' }, room, 'conversation.read')).toEqual({
      allowed: false,
      reason: 'inactive',
    });
    expect(decide({ ...base, isGuest: true }, room, 'conversation.read')).toEqual({
      allowed: false,
      reason: 'guest',
    });
    expect(decide({ ...base, onboarded: false }, room, 'conversation.read')).toEqual({
      allowed: false,
      reason: 'not_onboarded',
    });
    expect(decide({ ...base, emailVerified: false }, room, 'message.send')).toEqual({
      allowed: false,
      reason: 'unverified',
    });
    expect(decide(base, room, 'conversation.read')).toEqual({ allowed: false, reason: 'private' });
    expect(decide(base, room, 'message.send')).toEqual({ allowed: false, reason: 'not_member' });
    expect(decide(base, { ...room, bannedHere: true }, 'room.join_with_invite')).toEqual({
      allowed: false,
      reason: 'room_banned',
    });
    expect(
      decide(base, { ...room, membership: { role: 'member', muted: true } }, 'message.send'),
    ).toEqual({ allowed: false, reason: 'muted' });
    expect(decide(base, { ...room, kind: 'dm' }, 'room.update')).toEqual({
      allowed: false,
      reason: 'dm',
    });
  });
});

describe('decideGlobal', () => {
  const ACTIONS: GlobalAction[] = [
    'admin.access',
    'room.create',
    'dm.start',
    'report.create',
    'random.join',
  ];
  const base: Actor = {
    id: ACTOR_ID,
    role: 'user',
    status: 'active',
    isGuest: false,
    emailVerified: true,
    onboarded: true,
  };

  const TABLE: [string, Actor, GlobalAction[]][] = [
    ['member', base, ['room.create', 'dm.start', 'report.create', 'random.join']],
    ['admin', { ...base, role: 'admin' }, ACTIONS],
    // Guests: random mode and reporting only (D-025).
    [
      'guest',
      { ...base, isGuest: true, emailVerified: false, onboarded: false },
      ['report.create', 'random.join'],
    ],
    ['unverified', { ...base, emailVerified: false }, ['report.create', 'random.join']],
    ['not onboarded', { ...base, onboarded: false }, ['report.create', 'random.join']],
    ['suspended admin', { ...base, role: 'admin', status: 'suspended' }, []],
    ['banned', { ...base, status: 'banned' }, []],
    ['deleted', { ...base, status: 'deleted' }, []],
  ];

  it.each(TABLE)('%s', (_name, actor, allowed) => {
    expect(sorted(ACTIONS.filter((a) => decideGlobal(actor, a).allowed))).toEqual(sorted(allowed));
  });
});
