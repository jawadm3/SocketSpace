/**
 * Stored pictures (MSG-09, PROF-08): who may attach and see them, what a deleted message leaves
 * behind, and what the clean-up job may delete. Link-preview cache rules (MSG-08) are here too.
 */
import { eq, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LIMITS } from '@socketspace/shared/limits';

import { user } from '../schema/auth';
import { attachment, linkPreview } from '../schema/messages';
import {
  createTestDatabase,
  createTestDm,
  createTestRoom,
  createTestUser,
  type TestDatabase,
} from '../testing';
import { loadMessageWires } from '../wire';
import {
  createAttachment,
  deleteAttachmentRows,
  getAttachmentForViewer,
  listAttachmentGarbage,
  listAttachments,
} from './attachments';
import {
  getFreshLinkPreviews,
  getReadableMessageBody,
  linkMessageToPreviews,
  saveLinkPreview,
} from './link-previews';
import { deleteMessage } from './message-actions';
import { sendMessage } from './messages';
import { avatarWireOf, getPersonRows } from './people';
import { completeOnboarding, updateProfile } from './users';

let t: TestDatabase;
let n = 0;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.close();
});

function upload(
  uploaderId: string,
  size: { width: number; height: number } = { width: 800, height: 600 },
) {
  n += 1;
  return createAttachment(t.db, {
    uploaderId,
    storageKey: `m/${String(n).padStart(32, '0')}.webp`,
    mime: 'image/webp',
    bytes: 1234,
    sha256: 'a'.repeat(64),
    ...size,
  });
}

const avatarUpload = (uploaderId: string) => upload(uploaderId, { width: 256, height: 256 });

function send(conversationId: string, authorId: string, body: string, attachmentIds: string[]) {
  return sendMessage(t.db, { conversationId, authorId, clientId: uuidv4(), body, attachmentIds });
}

async function statusOf(id: string) {
  const [row] = await t.db.select().from(attachment).where(eq(attachment.id, id));
  return row?.status;
}

describe('pictures in messages (MSG-09)', () => {
  it("attaches the author's own unused uploads, in upload order, and sends them on the wire", async () => {
    const ava = await createTestUser(t.db);
    const room = await createTestRoom(t.db, ava.id);
    const first = await upload(ava.id);
    const second = await upload(ava.id, { width: 100, height: 50 });

    const sent = await send(room.id, ava.id, '', [second.id, first.id]);
    if (!sent.ok) throw new Error(sent.reason);
    expect(sent.attachments.map((a) => a.id)).toEqual([first.id, second.id]);
    expect(await statusOf(first.id)).toBe('attached');

    const [wire] = await loadMessageWires(t.db, [sent.message]);
    expect(wire?.body).toBe('');
    expect(wire?.attachments).toEqual([
      { id: first.id, width: 800, height: 600 },
      { id: second.id, width: 100, height: 50 },
    ]);
  });

  it("refuses someone else's upload, a used one and an unknown one, and writes nothing", async () => {
    const ava = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const room = await createTestRoom(t.db, ava.id, [sam.id]);
    const sams = await upload(sam.id);
    const mine = await upload(ava.id);

    expect(await send(room.id, ava.id, 'hi', [sams.id])).toMatchObject({
      ok: false,
      reason: 'attachment_invalid',
    });
    expect(await send(room.id, ava.id, 'hi', [mine.id, uuidv4()])).toMatchObject({
      ok: false,
      reason: 'attachment_invalid',
    });
    // The refused message left the picture unused.
    expect(await statusOf(mine.id)).toBe('pending');

    expect((await send(room.id, ava.id, 'once', [mine.id])).ok).toBe(true);
    expect(await send(room.id, ava.id, 'twice', [mine.id])).toMatchObject({
      ok: false,
      reason: 'attachment_invalid',
    });
    const [count] = await t.db
      .select({ value: sql<number>`count(*)::int` })
      .from(attachment)
      .where(eq(attachment.messageId, sql`(select id from message where body = 'twice')`));
    expect(count?.value).toBe(0);
  });

  it('a re-send with the same client ID keeps the pictures and attaches nothing twice', async () => {
    const ava = await createTestUser(t.db);
    const room = await createTestRoom(t.db, ava.id);
    const picture = await upload(ava.id);
    const clientId = uuidv4();
    const input = {
      conversationId: room.id,
      authorId: ava.id,
      clientId,
      body: 'look',
      attachmentIds: [picture.id],
    };
    const first = await sendMessage(t.db, input);
    const again = await sendMessage(t.db, input);
    if (!first.ok || !again.ok) throw new Error('expected both to succeed');
    expect(again.duplicate).toBe(true);
    expect(again.message.id).toBe(first.message.id);
    const [wire] = await loadMessageWires(t.db, [again.message]);
    expect(wire?.attachments.map((a) => a.id)).toEqual([picture.id]);
  });

  it('shows a picture only to people who may read the conversation', async () => {
    const ava = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const lee = await createTestUser(t.db);
    const closed = await createTestRoom(t.db, ava.id, [sam.id], { visibility: 'private' });
    const open = await createTestRoom(t.db, ava.id);
    const dm = await createTestDm(t.db, ava.id, sam.id);

    const inClosed = await upload(ava.id);
    const inOpen = await upload(ava.id);
    const inDm = await upload(ava.id);
    const unused = await upload(ava.id);
    await send(closed.id, ava.id, 'private', [inClosed.id]);
    await send(open.id, ava.id, 'public', [inOpen.id]);
    await send(dm.id, ava.id, 'dm', [inDm.id]);

    const sees = async (viewerId: string, id: string) =>
      (await getAttachmentForViewer(t.db, viewerId, id)) !== null;

    expect(await sees(sam.id, inClosed.id)).toBe(true);
    expect(await sees(lee.id, inClosed.id)).toBe(false);
    // A public room can be read by anyone signed in.
    expect(await sees(lee.id, inOpen.id)).toBe(true);
    expect(await sees(sam.id, inDm.id)).toBe(true);
    expect(await sees(lee.id, inDm.id)).toBe(false);
    // Not sent yet: only the uploader.
    expect(await sees(ava.id, unused.id)).toBe(true);
    expect(await sees(sam.id, unused.id)).toBe(false);
    expect(await sees(ava.id, uuidv4())).toBe(false);
  });

  it('a deleted message takes its pictures with it', async () => {
    const ava = await createTestUser(t.db);
    const room = await createTestRoom(t.db, ava.id);
    const picture = await upload(ava.id);
    const sent = await send(room.id, ava.id, 'oops', [picture.id]);
    if (!sent.ok) throw new Error(sent.reason);

    const deleted = await deleteMessage(t.db, { messageId: sent.message.id, actorId: ava.id });
    if (!deleted.ok) throw new Error(deleted.reason);
    expect(await statusOf(picture.id)).toBe('removed');
    expect(await getAttachmentForViewer(t.db, ava.id, picture.id)).toBeNull();
    expect((await listAttachments(t.db, [sent.message.id])).size).toBe(0);
    const [wire] = await loadMessageWires(t.db, [deleted.message]);
    expect(wire?.attachments).toEqual([]);
  });

  it('lists removed pictures and uploads unused for 24 hours for clean-up, nothing else', async () => {
    const ava = await createTestUser(t.db);
    const room = await createTestRoom(t.db, ava.id);
    const used = await upload(ava.id);
    const fresh = await upload(ava.id);
    const stale = await upload(ava.id);
    const gone = await upload(ava.id);
    await send(room.id, ava.id, 'kept', [used.id]);
    const sent = await send(room.id, ava.id, 'deleted', [gone.id]);
    if (!sent.ok) throw new Error(sent.reason);
    await deleteMessage(t.db, { messageId: sent.message.id, actorId: ava.id });
    await t.db
      .update(attachment)
      .set({ createdAt: sql`now() - interval '25 hours'` })
      .where(eq(attachment.id, stale.id));

    const garbage = (await listAttachmentGarbage(t.db, 1000)).map((g) => g.id);
    expect(garbage).toContain(stale.id);
    expect(garbage).toContain(gone.id);
    expect(garbage).not.toContain(used.id);
    expect(garbage).not.toContain(fresh.id);

    await deleteAttachmentRows(t.db, [stale.id, gone.id]);
    expect(await statusOf(stale.id)).toBeUndefined();
  });
});

describe('photo avatars (PROF-08)', () => {
  const profile = (nickname: string) => ({
    nickname,
    bio: '',
    realName: '',
    realNameVisibility: 'nobody' as const,
    nameDisplay: 'nickname' as const,
  });

  it('uses an uploaded square photo and sends it as a path on our own server', async () => {
    const ava = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const photo = await avatarUpload(ava.id);
    const saved = await updateProfile(t.db, ava.id, {
      ...profile(ava.nickname ?? ''),
      avatar: { kind: 'photo', config: { attachmentId: photo.id } },
    });
    expect(saved).toEqual({ ok: true, publicChanged: true });
    expect(await statusOf(photo.id)).toBe('attached');

    const [row] = await getPersonRows(t.db, [ava.id]);
    if (!row) throw new Error('no person');
    expect(avatarWireOf(row)).toEqual({ kind: 'photo', url: `/api/media/${photo.id}` });
    // Anyone signed in may load a profile photo.
    expect(await getAttachmentForViewer(t.db, sam.id, photo.id)).not.toBeNull();

    // Saving the profile again with the same photo changes nothing.
    const again = await updateProfile(t.db, ava.id, {
      ...profile(ava.nickname ?? ''),
      avatar: { kind: 'photo', config: { attachmentId: photo.id } },
    });
    expect(again).toEqual({ ok: true, publicChanged: false });
  });

  it('removes the old photo when it is replaced by a photo or a generated picture', async () => {
    const ava = await createTestUser(t.db);
    const first = await avatarUpload(ava.id);
    const second = await avatarUpload(ava.id);
    const set = (config: unknown, kind: 'photo' | 'preset' = 'photo') =>
      updateProfile(t.db, ava.id, { ...profile(ava.nickname ?? ''), avatar: { kind, config } });

    await set({ attachmentId: first.id });
    await set({ attachmentId: second.id });
    expect(await statusOf(first.id)).toBe('removed');
    expect(await statusOf(second.id)).toBe('attached');
    expect(await getAttachmentForViewer(t.db, ava.id, first.id)).toBeNull();

    await set({ style: 'lorelei', seed: 'x' }, 'preset');
    expect(await statusOf(second.id)).toBe('removed');
  });

  it("refuses someone else's upload, a message-sized picture and an unknown one", async () => {
    const ava = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const sams = await avatarUpload(sam.id);
    const wide = await upload(ava.id);
    for (const attachmentId of [sams.id, wide.id, uuidv4()]) {
      expect(
        await updateProfile(t.db, ava.id, {
          ...profile(ava.nickname ?? ''),
          avatar: { kind: 'photo', config: { attachmentId } },
        }),
      ).toEqual({ ok: false, reason: 'avatar_invalid' });
    }
    expect(await statusOf(sams.id)).toBe('pending');
    const [row] = await t.db.select().from(user).where(eq(user.id, ava.id));
    expect(row?.avatarKind).toBe('preset');
  });

  it('can finish onboarding with a photo, but only a valid one', async () => {
    const newcomer = await createTestUser(t.db, { onboarded: false });
    const photo = await avatarUpload(newcomer.id);
    expect(
      await completeOnboarding(t.db, newcomer.id, {
        nickname: `photo${String(n)}`,
        avatarKind: 'photo',
        avatarConfig: { attachmentId: uuidv4() },
      }),
    ).toEqual({ ok: false, reason: 'avatar_invalid' });
    expect(
      await completeOnboarding(t.db, newcomer.id, {
        nickname: `photo${String(n)}`,
        avatarKind: 'photo',
        avatarConfig: { attachmentId: photo.id },
      }),
    ).toEqual({ ok: true });
    const [row] = await t.db.select().from(user).where(eq(user.id, newcomer.id));
    expect(row?.onboardedAt).not.toBeNull();
    expect(await statusOf(photo.id)).toBe('attached');
  });
});

describe('link preview cache (MSG-08)', () => {
  const entry = (urlHash: string, ttlSeconds: number) => ({
    urlHash,
    url: 'https://example.com/',
    status: 'ok' as const,
    title: 'Example',
    description: null,
    siteName: null,
    ttlSeconds,
  });

  it('returns entries until they expire and refreshes them in place', async () => {
    await saveLinkPreview(t.db, entry('hash-fresh', LIMITS.linkPreview.ttlSeconds));
    await saveLinkPreview(t.db, entry('hash-old', 60));
    await t.db
      .update(linkPreview)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(linkPreview.urlHash, 'hash-old'));

    const fresh = await getFreshLinkPreviews(t.db, ['hash-fresh', 'hash-old', 'hash-none']);
    expect([...fresh.keys()]).toEqual(['hash-fresh']);

    await saveLinkPreview(t.db, { ...entry('hash-old', 60), title: 'Again' });
    expect((await getFreshLinkPreviews(t.db, ['hash-old'])).get('hash-old')?.title).toBe('Again');
  });

  it('gives a message body only to someone who may read it, and never a deleted one', async () => {
    const ava = await createTestUser(t.db);
    const lee = await createTestUser(t.db);
    const closed = await createTestRoom(t.db, ava.id, [], { visibility: 'private' });
    const sent = await send(closed.id, ava.id, 'see https://example.com', []);
    if (!sent.ok) throw new Error(sent.reason);

    expect(await getReadableMessageBody(t.db, ava.id, sent.message.id)).toBe(
      'see https://example.com',
    );
    expect(await getReadableMessageBody(t.db, lee.id, sent.message.id)).toBeNull();
    expect(await getReadableMessageBody(t.db, ava.id, uuidv4())).toBeNull();

    await saveLinkPreview(t.db, entry('hash-linked', 60));
    await linkMessageToPreviews(t.db, sent.message.id, ['hash-linked']);
    await linkMessageToPreviews(t.db, sent.message.id, ['hash-linked']);

    await deleteMessage(t.db, { messageId: sent.message.id, actorId: ava.id });
    expect(await getReadableMessageBody(t.db, ava.id, sent.message.id)).toBeNull();
  });
});
