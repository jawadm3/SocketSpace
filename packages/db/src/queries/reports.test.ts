/**
 * Reports (SAFE-01, ADMIN-01, PROF-08) and word-list flags (SAFE-02, ADMIN-02): what the server
 * keeps as evidence, who may report what, and what happens to a message the filter matched.
 */
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LIMITS } from '@socketspace/shared/limits';
import { MASK_CHAR, scanText } from '@socketspace/shared/moderation';

import { user } from '../schema/auth';
import { attachment, message } from '../schema/messages';
import { contentFlag, report } from '../schema/safety';
import {
  createTestDatabase,
  createTestDm,
  createTestRoom,
  createTestUser,
  type TestDatabase,
} from '../testing';
import { loadMessageWires, toMessageWire } from '../wire';
import { createAttachment, listAttachmentGarbage } from './attachments';
import { deleteMessage, editMessage } from './message-actions';
import { sendMessage, type FilterFinding } from './messages';
import { listNotifications } from './notifications';
import { createReport, recordWordListFlag, type ReportEvidence } from './reports';
import { updateProfile } from './users';

let t: TestDatabase;
let n = 0;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.close();
});

async function send(
  authorId: string,
  conversationId: string,
  body: string,
  filter?: FilterFinding,
) {
  const result = await sendMessage(t.db, {
    conversationId,
    authorId,
    clientId: uuidv4(),
    body,
    ...(filter ? { filter } : {}),
  });
  if (!result.ok) throw new Error(result.reason);
  return result.message;
}

/** What the realtime server passes along: the filter's finding for this text. */
function finding(body: string): FilterFinding {
  const { severity, categories } = scanText(body);
  return { severity, categories };
}

function upload(uploaderId: string, edge?: number) {
  n += 1;
  return createAttachment(t.db, {
    uploaderId,
    storageKey: `m/${String(n).padStart(32, '0')}.webp`,
    mime: 'image/webp',
    bytes: 1234,
    sha256: 'a'.repeat(64),
    width: edge ?? 800,
    height: edge ?? 600,
  });
}

async function reportRow(id: string) {
  const [row] = await t.db.select().from(report).where(eq(report.id, id));
  if (!row) throw new Error('report not stored');
  return { ...row, evidence: row.evidence as ReportEvidence };
}

const flagsOf = (userId: string) =>
  t.db.select().from(contentFlag).where(eq(contentFlag.userId, userId));

describe('reporting a message', () => {
  it('keeps a snapshot taken by the server: the text, what was around it, its pictures', async () => {
    const ava = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const room = await createTestRoom(t.db, ava.id, [sam.id]);
    for (let i = 1; i <= 7; i++) await send(ava.id, room.id, `before ${String(i)}`);
    const picture = await upload(sam.id);
    const sent = await sendMessage(t.db, {
      conversationId: room.id,
      authorId: sam.id,
      clientId: uuidv4(),
      body: 'buy my stuff',
      attachmentIds: [picture.id],
    });
    if (!sent.ok) throw new Error(sent.reason);
    for (let i = 1; i <= 7; i++) await send(ava.id, room.id, `after ${String(i)}`);

    const result = await createReport(t.db, {
      reporterId: ava.id,
      target: { type: 'message', messageId: sent.message.id },
      reason: 'spam',
      details: 'Third time today',
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.duplicate).toBe(false);

    const row = await reportRow(result.reportId);
    expect(row).toMatchObject({
      reporterId: ava.id,
      targetType: 'message',
      targetUserId: sam.id,
      messageId: sent.message.id,
      conversationId: room.id,
      reason: 'spam',
      details: 'Third time today',
      status: 'open',
    });
    const evidence = row.evidence;
    if (evidence.kind !== 'message') throw new Error('wrong evidence');
    expect(evidence.v).toBe(1);
    expect(evidence.conversation).toMatchObject({ id: room.id, kind: 'room', slug: room.slug });
    expect(evidence.message).toMatchObject({
      id: sent.message.id,
      authorId: sam.id,
      authorNickname: sam.nickname,
      body: 'buy my stuff',
      deleted: false,
      attachmentIds: [picture.id],
    });
    expect(evidence.attachmentIds).toEqual([picture.id]);
    // Five before and five after, oldest first, without the reported message itself.
    expect(evidence.context.map((m) => m.body)).toEqual([
      ...[3, 4, 5, 6, 7].map((i) => `before ${String(i)}`),
      ...[1, 2, 3, 4, 5].map((i) => `after ${String(i)}`),
    ]);
    expect(LIMITS.report.contextMessages).toBe(5);
  });

  it('is not changed by what the author does afterwards, and includes earlier edits', async () => {
    const ava = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const room = await createTestRoom(t.db, ava.id, [sam.id]);
    const original = await send(sam.id, room.id, 'first version');
    await editMessage(t.db, { messageId: original.id, editorId: sam.id, body: 'second version' });

    const result = await createReport(t.db, {
      reporterId: ava.id,
      target: { type: 'message', messageId: original.id },
      reason: 'harassment',
      details: '',
    });
    if (!result.ok) throw new Error(result.reason);

    await editMessage(t.db, { messageId: original.id, editorId: sam.id, body: 'nothing to see' });
    await deleteMessage(t.db, { messageId: original.id, actorId: sam.id });

    const { evidence } = await reportRow(result.reportId);
    if (evidence.kind !== 'message') throw new Error('wrong evidence');
    expect(evidence.message.body).toBe('second version');
    expect(evidence.revisions.map((r) => r.body)).toEqual(['first version']);
  });

  it('keeps the text as written when readers saw it masked', async () => {
    const ava = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const room = await createTestRoom(t.db, ava.id, [sam.id]);
    const body = 'you slut';
    const flagged = await send(sam.id, room.id, body, finding(body));
    const result = await createReport(t.db, {
      reporterId: ava.id,
      target: { type: 'message', messageId: flagged.id },
      reason: 'harassment',
      details: '',
    });
    if (!result.ok) throw new Error(result.reason);
    const { evidence } = await reportRow(result.reportId);
    if (evidence.kind !== 'message') throw new Error('wrong evidence');
    expect(evidence.message).toMatchObject({ body, filterSeverity: 2 });
  });

  it('only for messages the reporter can read, and never their own', async () => {
    const ava = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const outsider = await createTestUser(t.db);
    const secret = await createTestRoom(t.db, ava.id, [sam.id], { visibility: 'private' });
    const dm = await createTestDm(t.db, ava.id, sam.id);
    const inRoom = await send(sam.id, secret.id, 'private words');
    const inDm = await send(sam.id, dm.id, 'between us');
    const attempt = (reporterId: string, messageId: string) =>
      createReport(t.db, {
        reporterId,
        target: { type: 'message', messageId },
        reason: 'other',
        details: '',
      });

    expect(await attempt(outsider.id, inRoom.id)).toEqual({ ok: false, reason: 'not_found' });
    expect(await attempt(outsider.id, inDm.id)).toEqual({ ok: false, reason: 'not_found' });
    expect(await attempt(outsider.id, uuidv4())).toEqual({ ok: false, reason: 'not_found' });
    expect(await attempt(sam.id, inRoom.id)).toEqual({ ok: false, reason: 'self' });
    expect((await attempt(ava.id, inDm.id)).ok).toBe(true);
    const stored = await t.db.select().from(report).where(eq(report.reporterId, outsider.id));
    expect(stored).toEqual([]);
  });

  it('twice by the same person is one report while it is open', async () => {
    const ava = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const lee = await createTestUser(t.db);
    const room = await createTestRoom(t.db, ava.id, [sam.id, lee.id]);
    const sent = await send(sam.id, room.id, 'rude');
    const by = (reporterId: string) =>
      createReport(t.db, {
        reporterId,
        target: { type: 'message', messageId: sent.id },
        reason: 'harassment',
        details: '',
      });
    const first = await by(ava.id);
    const again = await by(ava.id);
    const other = await by(lee.id);
    if (!first.ok || !again.ok || !other.ok) throw new Error('setup');
    expect(again).toEqual({ ok: true, reportId: first.reportId, duplicate: true });
    expect(other.duplicate).toBe(false);
    expect(other.reportId).not.toBe(first.reportId);

    // Once a moderator has closed it, the same thing can be reported again.
    await t.db.update(report).set({ status: 'dismissed' }).where(eq(report.id, first.reportId));
    const later = await by(ava.id);
    expect(later).toMatchObject({ ok: true, duplicate: false });
  });

  it('is refused for an account that is not active', async () => {
    const ava = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const room = await createTestRoom(t.db, ava.id, [sam.id]);
    const sent = await send(sam.id, room.id, 'hello');
    await t.db.update(user).set({ status: 'suspended' }).where(eq(user.id, ava.id));
    expect(
      await createReport(t.db, {
        reporterId: ava.id,
        target: { type: 'message', messageId: sent.id },
        reason: 'other',
        details: '',
      }),
    ).toEqual({ ok: false, reason: 'reporter_inactive' });
  });
});

describe('reporting a person (PROF-08)', () => {
  const profile = (nickname: string) => ({
    nickname,
    bio: 'I sell things',
    realName: 'Sam Example',
    realNameVisibility: 'nobody' as const,
    nameDisplay: 'nickname' as const,
  });

  it('keeps the profile as the reporter could see it', async () => {
    const ava = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const room = await createTestRoom(t.db, ava.id, [sam.id]);
    await updateProfile(t.db, sam.id, profile(sam.nickname ?? ''));

    const result = await createReport(t.db, {
      reporterId: ava.id,
      target: { type: 'user', userId: sam.id, aspect: 'profile_text', conversationId: room.id },
      reason: 'spam',
      details: '',
    });
    if (!result.ok) throw new Error(result.reason);
    const row = await reportRow(result.reportId);
    expect(row).toMatchObject({
      targetType: 'user',
      targetUserId: sam.id,
      messageId: null,
      conversationId: room.id,
    });
    expect(row.evidence).toMatchObject({
      kind: 'user',
      aspect: 'profile_text',
      // The real name is hidden from this reporter, so it is not in the evidence either.
      profile: { id: sam.id, nickname: sam.nickname, realName: null, bio: 'I sell things' },
      attachmentIds: [],
    });
  });

  it('includes a real name the reporter was allowed to see', async () => {
    const ava = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    await updateProfile(t.db, sam.id, {
      ...profile(sam.nickname ?? ''),
      realNameVisibility: 'everyone',
    });
    const result = await createReport(t.db, {
      reporterId: ava.id,
      target: { type: 'user', userId: sam.id, aspect: 'profile_text' },
      reason: 'other',
      details: '',
    });
    if (!result.ok) throw new Error(result.reason);
    const { evidence, conversationId } = await reportRow(result.reportId);
    expect(conversationId).toBeNull();
    expect(evidence).toMatchObject({ profile: { realName: 'Sam Example' } });
  });

  it('keeps a reported profile photo until the report is closed, even if it is replaced', async () => {
    const ava = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const photo = await upload(sam.id, 256);
    const saved = await updateProfile(t.db, sam.id, {
      ...profile(sam.nickname ?? ''),
      avatar: { kind: 'photo', config: { attachmentId: photo.id } },
    });
    expect(saved.ok).toBe(true);

    const result = await createReport(t.db, {
      reporterId: ava.id,
      target: { type: 'user', userId: sam.id, aspect: 'profile_picture' },
      reason: 'sexual',
      details: '',
    });
    if (!result.ok) throw new Error(result.reason);
    const { evidence } = await reportRow(result.reportId);
    expect(evidence).toMatchObject({
      aspect: 'profile_picture',
      profile: { avatar: { kind: 'photo', url: `/api/media/${photo.id}` } },
      attachmentIds: [photo.id],
    });

    // The person swaps the photo for a generated picture: the old file is marked as removed...
    await updateProfile(t.db, sam.id, {
      ...profile(sam.nickname ?? ''),
      avatar: { kind: 'preset', config: { style: 'test', seed: 'x' } },
    });
    const [after] = await t.db
      .select({ status: attachment.status })
      .from(attachment)
      .where(eq(attachment.id, photo.id));
    expect(after?.status).toBe('removed');
    // ...but the clean-up job leaves it alone while the report is open.
    const garbage = async () => (await listAttachmentGarbage(t.db, 1000)).map((g) => g.id);
    expect(await garbage()).not.toContain(photo.id);
    await t.db.update(report).set({ status: 'actioned' }).where(eq(report.id, result.reportId));
    expect(await garbage()).toContain(photo.id);
  });

  it('a different aspect is a different report; the same aspect is not', async () => {
    const ava = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const about = (aspect: 'behaviour' | 'profile_picture') =>
      createReport(t.db, {
        reporterId: ava.id,
        target: { type: 'user', userId: sam.id, aspect },
        reason: 'other',
        details: '',
      });
    const first = await about('behaviour');
    const second = await about('profile_picture');
    const again = await about('behaviour');
    if (!first.ok || !second.ok || !again.ok) throw new Error('setup');
    expect(second.duplicate).toBe(false);
    expect(again).toEqual({ ok: true, reportId: first.reportId, duplicate: true });
  });

  it('not yourself, not an account that is gone, and no conversation you cannot read', async () => {
    const ava = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const gone = await createTestUser(t.db, { status: 'deleted' });
    const elsewhere = await createTestRoom(t.db, sam.id, [], { visibility: 'private' });
    const about = (userId: string, conversationId?: string) =>
      createReport(t.db, {
        reporterId: ava.id,
        target: { type: 'user', userId, aspect: 'behaviour', conversationId },
        reason: 'other',
        details: '',
      });
    expect(await about(ava.id)).toEqual({ ok: false, reason: 'self' });
    expect(await about(gone.id)).toEqual({ ok: false, reason: 'not_found' });
    expect(await about(uuidv4())).toEqual({ ok: false, reason: 'not_found' });
    const result = await about(sam.id, elsewhere.id);
    if (!result.ok) throw new Error(result.reason);
    // The report is stored, but the private room the reporter cannot read is not attached to it.
    expect((await reportRow(result.reportId)).conversationId).toBeNull();
  });
});

describe('reporting a room', () => {
  it('keeps what the room was called and who owned it', async () => {
    const owner = await createTestUser(t.db);
    const visitor = await createTestUser(t.db);
    const room = await createTestRoom(t.db, owner.id);
    const result = await createReport(t.db, {
      reporterId: visitor.id,
      target: { type: 'room', conversationId: room.id },
      reason: 'illegal',
      details: 'Selling stolen goods',
    });
    if (!result.ok) throw new Error(result.reason);
    const row = await reportRow(result.reportId);
    expect(row).toMatchObject({ targetType: 'room', conversationId: room.id, targetUserId: null });
    expect(row.evidence).toMatchObject({
      kind: 'room',
      room: { id: room.id, slug: room.slug, visibility: 'public', memberCount: 1 },
      owners: [{ id: owner.id, nickname: owner.nickname }],
    });
  });

  it('not a private room you are not in, and not a direct message', async () => {
    const owner = await createTestUser(t.db);
    const friend = await createTestUser(t.db);
    const outsider = await createTestUser(t.db);
    const secret = await createTestRoom(t.db, owner.id, [], { visibility: 'private' });
    const dm = await createTestDm(t.db, owner.id, friend.id);
    const about = (reporterId: string, conversationId: string) =>
      createReport(t.db, {
        reporterId,
        target: { type: 'room', conversationId },
        reason: 'other',
        details: '',
      });
    expect(await about(outsider.id, secret.id)).toEqual({ ok: false, reason: 'not_found' });
    expect(await about(owner.id, dm.id)).toEqual({ ok: false, reason: 'not_found' });
    expect(await about(outsider.id, uuidv4())).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('what the word-list filter does to a message (SAFE-02)', () => {
  it('low severity: stored and shown as written, nothing flagged', async () => {
    const ava = await createTestUser(t.db);
    const room = await createTestRoom(t.db, ava.id);
    const body = 'what a shit day';
    const saved = await send(ava.id, room.id, body, finding(body));
    expect(saved).toMatchObject({ filterSeverity: 1, moderationState: 'visible' });
    expect(toMessageWire(saved).body).toBe(body);
    expect(await flagsOf(ava.id)).toEqual([]);
  });

  it('medium severity: stored as written, masked for readers, flagged for a moderator', async () => {
    const ava = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const room = await createTestRoom(t.db, ava.id, [sam.id]);
    const body = `@${sam.nickname ?? ''} you slut`;
    const saved = await send(ava.id, room.id, body, finding(body));
    expect(saved).toMatchObject({ body, filterSeverity: 2, moderationState: 'flagged' });

    const masked = `@${sam.nickname ?? ''} you ${MASK_CHAR.repeat(4)}`;
    expect(toMessageWire(saved).body).toBe(masked);
    expect((await loadMessageWires(t.db, [saved]))[0]?.body).toBe(masked);
    // The notification list shows the masked text too.
    expect((await listNotifications(t.db, sam.id))[0]?.messageBody).toBe(masked);

    expect(await flagsOf(ava.id)).toMatchObject([
      {
        source: 'wordlist',
        severity: 'medium',
        categories: ['harassment'],
        messageId: saved.id,
        excerpt: body,
        reviewedAt: null,
      },
    ]);
  });

  it('high severity: nothing is stored or numbered; the attempt is flagged', async () => {
    const ava = await createTestUser(t.db);
    const room = await createTestRoom(t.db, ava.id);
    const body = 'kill yourself';
    const clientId = uuidv4();
    const result = await sendMessage(t.db, {
      conversationId: room.id,
      authorId: ava.id,
      clientId,
      body,
      filter: finding(body),
    });
    expect(result).toEqual({ ok: false, reason: 'content_blocked' });
    const stored = await t.db.select().from(message).where(eq(message.conversationId, room.id));
    expect(stored).toEqual([]);
    expect(await flagsOf(ava.id)).toMatchObject([
      { severity: 'high', categories: ['self_harm'], messageId: null, excerpt: body },
    ]);
    // The next message still gets number 1: the blocked one took no number.
    expect((await send(ava.id, room.id, 'sorry')).seq).toBe(1);
  });

  it('an edit is checked like a new message', async () => {
    const ava = await createTestUser(t.db);
    const room = await createTestRoom(t.db, ava.id);
    const saved = await send(ava.id, room.id, 'hello');
    const edit = (body: string) =>
      editMessage(t.db, { messageId: saved.id, editorId: ava.id, body, filter: finding(body) });

    const blocked = await edit('kys');
    expect(blocked).toMatchObject({ ok: false, reason: 'content_blocked' });
    const [unchanged] = await t.db.select().from(message).where(eq(message.id, saved.id));
    expect(unchanged).toMatchObject({ body: 'hello', editedAt: null });

    const flagged = await edit('hello slut');
    if (!flagged.ok) throw new Error(flagged.reason);
    expect(flagged.message).toMatchObject({ filterSeverity: 2, moderationState: 'flagged' });
    expect(toMessageWire(flagged.message).body).toBe(`hello ${MASK_CHAR.repeat(4)}`);

    const cleaned = await edit('hello friend');
    if (!cleaned.ok) throw new Error(cleaned.reason);
    expect(cleaned.message).toMatchObject({ filterSeverity: 0, moderationState: 'visible' });
    // Both attempts stay in front of the moderators.
    expect((await flagsOf(ava.id)).map((f) => f.severity).sort()).toEqual(['high', 'medium']);
  });

  it('keeps at most 20 unreviewed flags an hour per person, and a short excerpt', async () => {
    const ava = await createTestUser(t.db);
    const flag = () =>
      recordWordListFlag(t.db, {
        userId: ava.id,
        severity: 'high',
        categories: ['hate'],
        text: 'x'.repeat(2000),
      });
    for (let i = 0; i < LIMITS.flag.perUserPerHour; i++) expect(await flag()).toBe(true);
    expect(await flag()).toBe(false);
    const stored = await flagsOf(ava.id);
    expect(stored).toHaveLength(LIMITS.flag.perUserPerHour);
    expect(stored[0]?.excerpt).toHaveLength(LIMITS.flag.excerptMax);
  });
});
