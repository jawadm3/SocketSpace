import { describe, expect, it } from 'vitest';

import { ackError, ackOk, ackSchema } from '../errors';
import { LIMITS } from '../limits';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  messageAckSchema,
  messageSendSchema,
  messageWireSchema,
  randomJoinSchema,
  randomMessageSchema,
  reactionToggleSchema,
  syncRequestSchema,
} from './index';

const ID = '0192a5f0-0000-7000-8000-000000000001';
const ID2 = '0192a5f0-0000-7000-8000-000000000002';

describe('message:send payload', () => {
  const valid = { conversationId: ID, clientId: ID2, body: 'hello' };

  it('accepts a minimal message and trims it', () => {
    expect(messageSendSchema.parse({ ...valid, body: '  hello \n' })).toEqual(valid);
  });

  it('refuses unknown fields instead of ignoring them (v1 relayed an injected field)', () => {
    const result = messageSendSchema.safeParse({ ...valid, injected: true });
    expect(result.success).toBe(false);
  });

  it('refuses empty and whitespace-only bodies', () => {
    expect(messageSendSchema.safeParse({ ...valid, body: '' }).success).toBe(false);
    expect(messageSendSchema.safeParse({ ...valid, body: ' \n\t ' }).success).toBe(false);
    // Only invisible characters: empty after clean-up.
    expect(messageSendSchema.safeParse({ ...valid, body: '\u200B\u202E' }).success).toBe(false);
  });

  it('enforces 4,000 characters counted the way PostgreSQL counts them', () => {
    const max = 'a'.repeat(LIMITS.message.bodyMaxChars);
    expect(messageSendSchema.safeParse({ ...valid, body: max }).success).toBe(true);
    expect(messageSendSchema.safeParse({ ...valid, body: `${max}a` }).success).toBe(false);
    // 4,000 emoji are 8,000 UTF-16 units but 4,000 characters: allowed.
    const emoji = '😀'.repeat(LIMITS.message.bodyMaxChars);
    expect(messageSendSchema.safeParse({ ...valid, body: emoji }).success).toBe(true);
  });

  it('refuses the 100,000-character message that v1 relayed', () => {
    expect(messageSendSchema.safeParse({ ...valid, body: 'x'.repeat(100_000) }).success).toBe(
      false,
    );
  });

  it('refuses malformed IDs and wrong types', () => {
    expect(messageSendSchema.safeParse({ ...valid, conversationId: 'room-1' }).success).toBe(false);
    expect(messageSendSchema.safeParse({ ...valid, body: 42 }).success).toBe(false);
    expect(messageSendSchema.safeParse(null).success).toBe(false);
    expect(messageSendSchema.safeParse('hello').success).toBe(false);
  });

  it('limits attachments', () => {
    const ids = Array.from({ length: LIMITS.message.attachmentsMax + 1 }, () => ID);
    expect(messageSendSchema.safeParse({ ...valid, attachmentIds: ids }).success).toBe(false);
  });
});

describe('other client payloads', () => {
  it('reaction:toggle accepts only allow-listed emoji', () => {
    expect(reactionToggleSchema.safeParse({ messageId: ID, emoji: '👍' }).success).toBe(true);
    expect(reactionToggleSchema.safeParse({ messageId: ID, emoji: 'lol' }).success).toBe(false);
    expect(reactionToggleSchema.safeParse({ messageId: ID, emoji: '<img>' }).success).toBe(false);
  });

  it('sync:request allows up to 50 distinct conversations', () => {
    const cursor = (n: number) => ({
      conversationId: `0192a5f0-0000-7000-8000-${String(n).padStart(12, '0')}`,
      afterEventSeq: 0,
    });
    const fifty = Array.from({ length: 50 }, (_, i) => cursor(i));
    expect(syncRequestSchema.safeParse({ cursors: fifty }).success).toBe(true);
    expect(syncRequestSchema.safeParse({ cursors: [...fifty, cursor(50)] }).success).toBe(false);
    expect(syncRequestSchema.safeParse({ cursors: [cursor(1), cursor(1)] }).success).toBe(false);
    expect(syncRequestSchema.safeParse({ cursors: [] }).success).toBe(false);
    expect(
      syncRequestSchema.safeParse({ cursors: [{ ...cursor(1), afterEventSeq: -1 }] }).success,
    ).toBe(false);
  });

  it('random:join normalises interests to lower case and removes duplicates', () => {
    expect(randomJoinSchema.parse({ interests: ['Chess', ' chess ', 'Music'] })).toEqual({
      interests: ['chess', 'music'],
    });
    expect(randomJoinSchema.safeParse({ interests: ['a'] }).success).toBe(false);
    expect(
      randomJoinSchema.safeParse({ interests: ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'] }).success,
    ).toBe(false);
  });

  it('random:message caps text at 1,000 characters', () => {
    const base = { sessionId: ID, clientId: ID2 };
    expect(randomMessageSchema.safeParse({ ...base, text: 'x'.repeat(1000) }).success).toBe(true);
    expect(randomMessageSchema.safeParse({ ...base, text: 'x'.repeat(1001) }).success).toBe(false);
  });
});

describe('event tables', () => {
  it('cover every client event in the protocol document', () => {
    expect(Object.keys(CLIENT_EVENTS).sort()).toEqual(
      [
        'message:send',
        'message:edit',
        'message:delete',
        'reaction:toggle',
        'typing:set',
        'read:update',
        'delivery:ack',
        'sync:request',
        'presence:set',
        'random:join',
        'random:leave',
        'random:message',
        'random:typing',
        'random:next',
        'random:end',
        'random:report',
        'random:block',
        'random:offer',
        'random:accept',
        'random:resume',
      ].sort(),
    );
  });

  it('mark exactly the fire-and-forget events as having no acknowledgement', () => {
    const noAck = Object.entries(CLIENT_EVENTS)
      .filter(([, spec]) => spec.ack === null)
      .map(([name]) => name)
      .sort();
    expect(noAck).toEqual(['delivery:ack', 'random:typing', 'typing:set']);
  });

  it('give every server event a schema', () => {
    for (const [name, schema] of Object.entries(SERVER_EVENTS)) {
      expect(typeof schema.safeParse, name).toBe('function');
    }
  });
});

describe('acknowledgements', () => {
  const wire = {
    id: ID,
    conversationId: ID2,
    seq: 1,
    eventSeq: 1,
    authorId: ID,
    clientId: ID2,
    kind: 'text',
    body: 'hi',
    replyToId: null,
    editedAt: null,
    deletedAt: null,
    deletedBy: null,
    moderationState: 'visible',
    createdAt: '2026-10-02T09:30:00.000Z',
    reactions: [],
    attachments: [],
  } as const;

  it('validate the success and error shapes', () => {
    const schema = ackSchema(messageAckSchema);
    expect(schema.safeParse(ackOk({ message: wire })).success).toBe(true);
    expect(schema.safeParse(ackError('RATE_LIMITED', 'Slow down', 1500)).success).toBe(true);
    expect(schema.safeParse({ ok: false, error: { code: 'TEAPOT', message: 'x' } }).success).toBe(
      false,
    );
    expect(messageWireSchema.safeParse({ ...wire, createdAt: 'yesterday' }).success).toBe(false);
  });

  it('omit retryAfterMs unless given', () => {
    expect(ackError('FORBIDDEN', 'No')).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'No' },
    });
  });
});
