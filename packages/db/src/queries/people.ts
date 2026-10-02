/**
 * People as other people see them (realtime-protocol.md, "People in payloads"; D-024).
 *
 * Every person sent to a browser goes through `getPublicUsers`, which decides per viewer whether
 * a real name may be included. Broadcasts to many viewers use `nicknameOnly` instead, because one
 * message cannot carry different names for different readers.
 */
import { and, eq, inArray } from 'drizzle-orm';

import {
  avatarConfigSchema,
  realNameForViewer,
  type AvatarWire,
  type PublicUser,
} from '@socketspace/shared/profile';

import type { Queryable } from '../client';
import { user } from '../schema/auth';
import { contact } from '../schema/social';

/** What a deleted account shows instead of its nickname. Contains a space, so no nickname can match it. */
export const DELETED_USER_NAME = 'Deleted user';

const personColumns = {
  id: user.id,
  nickname: user.nickname,
  name: user.name,
  realNameVisibility: user.realNameVisibility,
  nameDisplay: user.nameDisplay,
  avatarKind: user.avatarKind,
  avatarConfig: user.avatarConfig,
  image: user.image,
  status: user.status,
  role: user.role,
  showPresence: user.showPresence,
};

export interface PersonRow {
  id: string;
  nickname: string | null;
  name: string;
  realNameVisibility: 'nobody' | 'contacts' | 'everyone';
  nameDisplay: 'nickname' | 'real_name' | 'both';
  avatarKind: 'preset' | 'custom' | 'photo' | null;
  avatarConfig: unknown;
  image: string | null;
  status: 'active' | 'suspended' | 'banned' | 'deleted';
  /** Site role, for permission checks on the server. Never sent to browsers. */
  role: 'user' | 'admin';
  /** False in invisible mode. Never sent to browsers. */
  showPresence: boolean;
}

/**
 * The avatar as browsers receive it. Generated avatars travel as settings (rendered locally, with
 * no third-party request). Photo avatars arrive with the upload pipeline in Stage D5; until then a
 * photo shows the fallback avatar.
 */
export function avatarWireOf(
  row: Pick<PersonRow, 'avatarKind' | 'avatarConfig'>,
): AvatarWire | null {
  if (row.avatarKind === 'preset' || row.avatarKind === 'custom') {
    const config = avatarConfigSchema.safeParse(row.avatarConfig);
    return config.success ? { kind: 'generated', config: config.data } : null;
  }
  return null;
}

function toPublicUser(row: PersonRow, realName: string | undefined): PublicUser {
  if (row.status === 'deleted') return { id: row.id, nickname: DELETED_USER_NAME, avatar: null };
  const person: PublicUser = {
    id: row.id,
    nickname: row.nickname ?? DELETED_USER_NAME,
    avatar: avatarWireOf(row),
  };
  if (realName !== undefined) person.realName = realName;
  return person;
}

/** The nickname-only shape, for broadcasts that many viewers receive at once. */
export function nicknameOnly(row: PersonRow): PublicUser {
  return toPublicUser(row, undefined);
}

export async function getPersonRows(db: Queryable, ids: readonly string[]): Promise<PersonRow[]> {
  if (ids.length === 0) return [];
  return db
    .select(personColumns)
    .from(user)
    .where(inArray(user.id, [...new Set(ids)]));
}

/**
 * People as `viewerId` may see them, in the order asked (unknown IDs are left out).
 * `context` is 'chat' for names next to messages and member lists, 'profile' for a profile card.
 */
export async function getPublicUsers(
  db: Queryable,
  viewerId: string,
  ids: readonly string[],
  context: 'chat' | 'profile' = 'chat',
): Promise<PublicUser[]> {
  const rows = await getPersonRows(db, ids);
  if (rows.length === 0) return [];
  const others = rows.filter((r) => r.id !== viewerId).map((r) => r.id);
  const contacts =
    others.length === 0
      ? new Set<string>()
      : new Set(
          (
            await db
              .select({ contactId: contact.contactId })
              .from(contact)
              .where(and(eq(contact.userId, viewerId), inArray(contact.contactId, others)))
          ).map((c) => c.contactId),
        );
  const byId = new Map(
    rows.map((row) => [
      row.id,
      toPublicUser(
        row,
        realNameForViewer(
          row,
          { isSelf: row.id === viewerId, isContact: contacts.has(row.id) },
          context,
        ),
      ),
    ]),
  );
  return [...new Set(ids)].flatMap((id) => {
    const person = byId.get(id);
    return person ? [person] : [];
  });
}
