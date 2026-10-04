/**
 * Random-match mode on the realtime server (RAND-01 to RAND-10; realtime-protocol.md, "Events:
 * random-match mode"; security.md 4.3).
 *
 * Everything about a chat lives in this server's memory: who is waiting (matcher.ts), who is
 * paired with whom, and the last 20 messages of each chat (the "evidence buffer"), which exist
 * only so that a report can show a moderator what was said. A chat's memory is dropped 5 minutes
 * after it ends. The database gets metadata (one `random_session` row without text), reports,
 * automatic timeouts, contacts both people agreed to, and aggregate counters.
 *
 * Messages are relayed, never stored. Before a message is relayed it is checked for links and
 * contact details (refused) and read by the word-list filter with the strict random-mode rules:
 * low and medium severity are masked, high severity is not sent at all, ends the chat and pauses
 * random mode for the sender for 1 hour.
 *
 * One realtime instance is assumed (the free deployment): the queue is not shared between
 * instances, so with several, people are only paired with others on the same instance.
 */
import { createHmac, randomUUID } from 'node:crypto';

import {
  addRandomContact,
  applyAutomaticRandomTimeout,
  blockUser,
  bumpMetric,
  createRandomReport,
  endRandomSession,
  getPersonRows,
  getRandomEntry,
  hitRateLimit,
  nicknameOnly,
  recordWordListFlag,
  startRandomSession,
  suggestRoomsForInterests,
  type AutomaticTimeoutCause,
  type Database,
  type RandomEndReason,
  type RandomEntry,
} from '@socketspace/db';
import { decideGlobal } from '@socketspace/shared/authz';
import type { ReportReason } from '@socketspace/shared/domain';
import { ackError, ackOk, type Ack } from '@socketspace/shared/errors';
import type {
  AckData,
  ClientPayload,
  ServerEventName,
  ServerPayload,
} from '@socketspace/shared/events';
import { LIMITS } from '@socketspace/shared/limits';
import { findContactDetails, moderateText } from '@socketspace/shared/moderation';
import { isRandomGateAccepted } from '@socketspace/shared/random';

import { describeError } from '../handlers/define';
import { applyInternalEvent } from '../internal';
import type { Logger } from '../logger';
import type { Metrics } from '../metrics';
import { rooms, type IoServer, type IoSocket } from '../types';
import { MatchQueue, type MatchedPair, type QueueEntry } from './matcher';

export interface RandomTimings {
  matchIntervalMs: number;
  fallbackAfterMs: number;
  rematchAfterMs: number;
  evidenceKeepMs: number;
  reconnectGraceMs: number;
  silenceMs: number;
  fastSkipMs: number;
  skipCooldownMs: number;
}

export const DEFAULT_RANDOM_TIMINGS: RandomTimings = {
  matchIntervalMs: LIMITS.random.matchIntervalMs,
  fallbackAfterMs: LIMITS.random.fallbackAfterMs,
  rematchAfterMs: LIMITS.random.rematchAfterMs,
  evidenceKeepMs: LIMITS.random.evidenceKeepMs,
  reconnectGraceMs: LIMITS.random.reconnectGraceMs,
  silenceMs: LIMITS.random.silenceMs,
  fastSkipMs: LIMITS.random.fastSkipMs,
  skipCooldownMs: LIMITS.random.skipCooldownMs,
};

export interface RandomDeps {
  io: IoServer;
  db: Database;
  logger: Logger;
  metrics: Metrics;
  /** The secret network addresses are hashed with (a keyed hash, so raw addresses are never stored). */
  ipHashSecret: string;
  timings?: Partial<RandomTimings>;
  afterDatabaseWork: () => void;
}

type Offer = ClientPayload<'random:offer'>['offer'];
type Timer = ReturnType<typeof setTimeout>;

interface Participant {
  userId: string;
  /** The tab the chat is in; null while its connection is down (it may come back). */
  socketId: string | null;
  guest: boolean;
  ip: string;
  interests: string[];
  graceTimer: Timer | null;
  /** Client IDs already relayed, so a re-sent message is not shown twice. */
  clientIds: string[];
}

/** One message in the evidence buffer. Memory only; copied into a report if someone files one. */
export interface BufferedMessage {
  senderId: string;
  clientId: string;
  /** As written. */
  text: string;
  /** As both people saw it (masked where the filter matched). */
  shown: string;
  atMs: number;
  /** False: stopped by the filter, never shown to the other person. */
  delivered: boolean;
}

interface Session {
  id: string;
  a: Participant;
  b: Participant;
  sharedInterests: string[];
  startedAtMs: number;
  endedAtMs: number | null;
  buffer: BufferedMessage[];
  wants: Record<Offer, Set<string>>;
  done: Set<Offer>;
  profilesShared: boolean;
  silenceTimer: Timer | null;
  dropTimer: Timer | null;
}

const MESSAGES = {
  off: 'Random chat is switched off.',
  ended: 'This chat has ended.',
  inChat: 'You are already in a random chat. End it first, or go back to the tab it is open in.',
  inQueue: 'You are already looking for a chat in another tab.',
  account: 'This account cannot use random chat.',
  profile: 'Please finish setting up your profile first.',
  gate: 'Please confirm that you are 18 or older and accept the random chat rules first.',
  network: 'Random chat is paused on this network connection.',
  skipping: 'You skipped several chats within seconds. Matching is paused for a moment.',
  link: "Links aren't allowed in random chats.",
  contact:
    "Contact details (email addresses, phone numbers, usernames on other apps) aren't allowed in random chats.",
  blocked:
    'This message was not sent: it contains words that are not allowed here. The chat has ended.',
  reportLate:
    'This chat can no longer be reported. Reports are possible until 5 minutes after a chat ends.',
  reportRate: 'You have sent many reports in a short time. Please try again later.',
  guests: 'Profiles and contacts can only be shared when both of you have an account.',
  nothingToAccept: 'There is nothing to accept yet.',
  contactRefused: 'This contact could not be added.',
  otherTab: 'This chat is open in another tab.',
} as const;

export const RANDOM_OFF_MESSAGE = MESSAGES.off;

const CLIENT_IDS_KEPT = 50;

function participantOf(session: Session, userId: string): Participant | null {
  if (session.a.userId === userId) return session.a;
  return session.b.userId === userId ? session.b : null;
}

function partnerOf(session: Session, userId: string): Participant {
  return session.a.userId === userId ? session.b : session.a;
}

export class RandomManager {
  private readonly timings: RandomTimings;
  private readonly queue: MatchQueue;
  /** Chats going on now. */
  private readonly live = new Map<string, Session>();
  /** Ended chats, kept for 5 minutes so they can still be reported. */
  private readonly retained = new Map<string, Session>();
  /** The live chat of each person (one at a time). */
  private readonly byUser = new Map<string, string>();
  /** People taken out of the queue whose chat is being written to the database. */
  private readonly starting = new Map<string, { cancelled: boolean }>();
  private readonly skips = new Map<string, { fast: number; untilMs: number }>();
  /** A guest's blocks: guests are throwaway accounts, so these are kept in memory only. */
  private readonly guestAvoid = new Map<string, Set<string>>();
  private ticker: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(private readonly deps: RandomDeps) {
    this.timings = { ...DEFAULT_RANDOM_TIMINGS, ...deps.timings };
    this.queue = new MatchQueue({
      fallbackAfterMs: this.timings.fallbackAfterMs,
      rematchAfterMs: this.timings.rematchAfterMs,
    });
    deps.metrics.registerGauge(
      'ss_random_queue_length',
      'People waiting for a random chat.',
      () => this.queue.size,
    );
    deps.metrics.registerGauge(
      'ss_random_sessions_active',
      'Random chats going on.',
      () => this.live.size,
    );
    deps.metrics.registerGauge(
      'ss_random_longest_wait_ms',
      'How long the longest-waiting person has waited.',
      () => this.queue.longestWaitMs(Date.now()),
    );
  }

  // Small helpers ----------------------------------------------------------------------------------

  private isConnected(socketId: string | null): boolean {
    return socketId !== null && this.deps.io.sockets.sockets.get(socketId)?.connected === true;
  }

  private send<E extends ServerEventName>(
    to: Participant,
    event: E,
    payload: ServerPayload<E>,
  ): void {
    if (!to.socketId) return;
    // One typed table of events, but `emit` cannot follow a generic event name.
    const target = this.deps.io.to(to.socketId) as unknown as {
      emit: (event: E, payload: ServerPayload<E>) => boolean;
    };
    target.emit(event, payload);
  }

  private hashIp(ip: string): string {
    return createHmac('sha256', this.deps.ipHashSecret).update(`ip:${ip}`).digest('hex');
  }

  private logFailure(what: string) {
    return (error: unknown) => {
      this.deps.logger.warn({ error: describeError(error) }, what);
    };
  }

  /** The live chat this tab is in, with both sides, or null. */
  private liveFor(socket: IoSocket, sessionId: string) {
    const session = this.live.get(sessionId);
    const me = session ? participantOf(session, socket.data.userId) : null;
    if (!session || me?.socketId !== socket.id) return null;
    return { session, me, partner: partnerOf(session, me.userId) };
  }

  /** A chat this person was in, going on or recently ended. */
  private knownFor(socket: IoSocket, sessionId: string) {
    const session = this.live.get(sessionId) ?? this.retained.get(sessionId);
    const me = session ? participantOf(session, socket.data.userId) : null;
    return session && me ? { session, me, partner: partnerOf(session, me.userId) } : null;
  }

  private cooldownLeft(userId: string): number {
    return Math.max(0, (this.skips.get(userId)?.untilMs ?? 0) - Date.now());
  }

  // Joining the queue ------------------------------------------------------------------------------

  /** Why this person cannot wait for a chat right now (already chatting, or waiting elsewhere). */
  private busy(socket: IoSocket): Ack<never> | null {
    const { userId } = socket.data;
    if (this.byUser.has(userId) || this.starting.has(userId)) {
      return ackError('CONFLICT', MESSAGES.inChat);
    }
    const waiting = this.queue.get(userId);
    if (waiting && waiting.socketId !== socket.id && this.isConnected(waiting.socketId)) {
      return ackError('CONFLICT', MESSAGES.inQueue);
    }
    return null;
  }

  private refusalFor(entry: RandomEntry, guest: boolean): Ack<never> | null {
    const { actor } = entry;
    if (!actor || !decideGlobal(actor, 'random.join').allowed) {
      return ackError('FORBIDDEN', MESSAGES.account);
    }
    if (!guest && !actor.onboarded) return ackError('FORBIDDEN', MESSAGES.profile);
    if (!isRandomGateAccepted(entry.gate)) return ackError('FORBIDDEN', MESSAGES.gate);
    const left = (until: Date | null) =>
      until ? Math.max(0, until.getTime() - Date.now()) : undefined;
    if (entry.pause) {
      return ackError(
        'FORBIDDEN',
        `Random chat is paused for you. Reason: ${entry.pause.reason}`,
        left(entry.pause.until),
      );
    }
    if (entry.networkBanUntil) {
      return ackError('FORBIDDEN', MESSAGES.network, left(entry.networkBanUntil));
    }
    return null;
  }

  async join(socket: IoSocket, interests: string[]): Promise<Ack<AckData<'random:join'>>> {
    const { userId, guest, ip } = socket.data;
    const busy = this.busy(socket);
    if (busy) return busy;
    const cooldown = this.cooldownLeft(userId);
    if (cooldown > 0) return ackError('RATE_LIMITED', MESSAGES.skipping, cooldown);

    const entry = await getRandomEntry(this.deps.db, userId, {
      ipHash: guest ? this.hashIp(ip) : null,
    });
    this.deps.afterDatabaseWork();
    const refusal = this.refusalFor(entry, guest);
    if (refusal) return refusal;
    // The database was asked in between: another tab may have joined, or this one closed.
    const busyNow = this.busy(socket);
    if (busyNow) return busyNow;
    if (!socket.connected || this.stopped) return ackError('UNAVAILABLE', MESSAGES.ended);

    const now = Date.now();
    this.queue.add({
      userId,
      socketId: socket.id,
      guest,
      ip,
      interests,
      joinedAtMs: now,
      avoid: new Set([...entry.avoid, ...(this.guestAvoid.get(userId) ?? [])]),
    });
    socket.emit('random:waiting', { since: new Date(now).toISOString() });
    this.runMatcher();
    return ackOk({ queued: true });
  }

  /** Stops waiting, or ends the chat this tab is in. */
  leave(socket: IoSocket): Ack<AckData<'random:leave'>> {
    const { userId } = socket.data;
    if (this.queue.get(userId)?.socketId === socket.id) this.queue.remove(userId);
    const starting = this.starting.get(userId);
    if (starting) starting.cancelled = true;
    const sessionId = this.byUser.get(userId);
    const found = sessionId ? this.liveFor(socket, sessionId) : null;
    if (found) void this.finish(found.session, 'end', userId);
    return ackOk({});
  }

  // Matching ---------------------------------------------------------------------------------------

  private runMatcher(): void {
    if (this.stopped) return;
    for (const pair of this.queue.match(Date.now())) void this.startSession(pair);
    if (this.queue.size === 0) {
      if (this.ticker) clearInterval(this.ticker);
      this.ticker = null;
    } else if (!this.ticker) {
      this.ticker = setInterval(() => {
        this.runMatcher();
      }, this.timings.matchIntervalMs);
      this.ticker.unref();
    }
  }

  private requeue(entries: readonly QueueEntry[]): void {
    for (const entry of entries) {
      const cancelled = this.starting.get(entry.userId)?.cancelled === true;
      this.starting.delete(entry.userId);
      // Back in the queue with the time already waited.
      if (!cancelled && this.isConnected(entry.socketId)) this.queue.add(entry);
    }
    this.runMatcher();
  }

  private async startSession({ a, b, sharedInterests }: MatchedPair): Promise<void> {
    const { db, logger, metrics } = this.deps;
    this.starting.set(a.userId, { cancelled: false });
    this.starting.set(b.userId, { cancelled: false });
    let row: { id: string; startedAt: Date };
    try {
      row = await startRandomSession(db, {
        participantA: a.userId,
        participantB: b.userId,
        sharedInterestCount: sharedInterests.length,
      });
      this.deps.afterDatabaseWork();
    } catch (error) {
      logger.error({ error: describeError(error) }, 'random chat not started');
      this.requeue([a, b]);
      return;
    }
    const gone = [a, b].some(
      (e) => this.starting.get(e.userId)?.cancelled === true || !this.isConnected(e.socketId),
    );
    if (gone || this.stopped) {
      // Someone left in the meantime: the other keeps their place in the queue.
      await endRandomSession(db, row.id, 'disconnect').catch(this.logFailure('chat not closed'));
      this.requeue([a, b]);
      return;
    }
    this.starting.delete(a.userId);
    this.starting.delete(b.userId);

    const now = Date.now();
    this.queue.notePair(a.userId, b.userId, now);
    const participant = (entry: QueueEntry): Participant => ({
      userId: entry.userId,
      socketId: entry.socketId,
      guest: entry.guest,
      ip: entry.ip,
      interests: entry.interests,
      graceTimer: null,
      clientIds: [],
    });
    const session: Session = {
      id: row.id,
      a: participant(a),
      b: participant(b),
      sharedInterests,
      startedAtMs: now,
      endedAtMs: null,
      buffer: [],
      wants: { share_profile: new Set(), add_contact: new Set() },
      done: new Set(),
      profilesShared: false,
      silenceTimer: null,
      dropTimer: null,
    };
    this.live.set(session.id, session);
    this.byUser.set(a.userId, session.id);
    this.byUser.set(b.userId, session.id);
    this.armSilenceTimer(session);
    metrics.increment('ss_random_sessions_started_total');
    metrics.increment('ss_random_matched_people_total', {}, 2);
    metrics.increment('ss_random_wait_ms_total', {}, now - a.joinedAtMs + (now - b.joinedAtMs));
    for (const p of [session.a, session.b]) {
      this.send(p, 'random:matched', {
        sessionId: session.id,
        partner: { alias: 'Stranger', sharedInterests },
      });
    }
  }

  private armSilenceTimer(session: Session): void {
    if (session.silenceTimer) clearTimeout(session.silenceTimer);
    session.silenceTimer = setTimeout(() => {
      void this.finish(session, 'timeout', null);
    }, this.timings.silenceMs);
    session.silenceTimer.unref();
  }

  // Ending -----------------------------------------------------------------------------------------

  /**
   * Ends a chat: tells both people (except the one who pressed "Next"), suggests rooms, keeps
   * the evidence buffer for 5 more minutes, and records the end in the database. Resolves when
   * the database has it.
   */
  private finish(
    session: Session,
    reason: RandomEndReason,
    actorId: string | null,
    tellActor = true,
  ): Promise<void> {
    if (session.endedAtMs !== null) return Promise.resolve();
    const now = Date.now();
    session.endedAtMs = now;
    this.live.delete(session.id);
    this.retained.set(session.id, session);
    if (session.silenceTimer) clearTimeout(session.silenceTimer);
    session.silenceTimer = null;
    session.dropTimer = setTimeout(() => {
      this.retained.delete(session.id);
    }, this.timings.evidenceKeepMs);
    session.dropTimer.unref();
    this.deps.metrics.increment('ss_random_sessions_ended_total', { reason });

    if (reason === 'skip' && actorId) this.noteSkip(actorId, now - session.startedAtMs);
    for (const p of [session.a, session.b]) {
      if (this.byUser.get(p.userId) === session.id) this.byUser.delete(p.userId);
      if (p.graceTimer) clearTimeout(p.graceTimer);
      p.graceTimer = null;
      if (!tellActor && p.userId === actorId) continue;
      // Being reported is not announced to the person reported: they see an ordinary ending.
      const shown = reason === 'report' && p.userId !== actorId ? 'end' : reason;
      this.send(p, 'random:ended', { sessionId: session.id, reason: shown });
      void this.suggest(session, p);
    }
    return endRandomSession(this.deps.db, session.id, reason).then(() => {
      this.deps.afterDatabaseWork();
    }, this.logFailure('end of chat not recorded'));
  }

  /** Repeated skips within seconds pause matching (security.md 4.3, against harvesting). */
  private noteSkip(userId: string, chatLastedMs: number): void {
    const state = this.skips.get(userId) ?? { fast: 0, untilMs: 0 };
    state.fast = chatLastedMs < this.timings.fastSkipMs ? state.fast + 1 : 0;
    if (state.fast >= LIMITS.random.fastSkipsBeforeCooldown) {
      state.fast = 0;
      state.untilMs = Date.now() + this.timings.skipCooldownMs;
      this.deps.metrics.increment('ss_random_skip_cooldowns_total');
    }
    this.skips.set(userId, state);
  }

  /** The way from a random chat into the community: public rooms about the shared interests. */
  private async suggest(session: Session, to: Participant): Promise<void> {
    if (this.stopped) return;
    try {
      const rooms = await suggestRoomsForInterests(this.deps.db, {
        interests: session.sharedInterests.length > 0 ? session.sharedInterests : to.interests,
        viewerId: to.userId,
      });
      this.send(to, 'random:suggestion', { rooms });
    } catch (error) {
      this.logFailure('room suggestions not sent')(error);
    }
  }

  next(socket: IoSocket, sessionId: string): Promise<Ack<AckData<'random:next'>>> {
    const found = this.knownFor(socket, sessionId);
    if (!found) return Promise.resolve(ackError('NOT_FOUND', MESSAGES.ended));
    if (this.liveFor(socket, sessionId)) {
      void this.finish(found.session, 'skip', found.me.userId, false);
    }
    return this.join(socket, found.me.interests);
  }

  end(socket: IoSocket, sessionId: string): Ack<AckData<'random:end'>> {
    const found = this.knownFor(socket, sessionId);
    if (!found) return ackError('NOT_FOUND', MESSAGES.ended);
    if (this.liveFor(socket, sessionId)) void this.finish(found.session, 'end', found.me.userId);
    return ackOk({});
  }

  // Messages ---------------------------------------------------------------------------------------

  private remember(session: Session, message: BufferedMessage): void {
    session.buffer.push(message);
    while (session.buffer.length > LIMITS.random.evidenceMessages) session.buffer.shift();
  }

  /** A filter hit for the moderators: who, how severe, which categories. Never the text. */
  private flag(
    userId: string,
    severity: 'medium' | 'high',
    categories: readonly string[],
    sessionId: string,
  ): Promise<void> {
    return recordWordListFlag(this.deps.db, {
      userId,
      severity,
      categories,
      text: '',
      randomSessionId: sessionId,
    }).then(() => {
      this.deps.afterDatabaseWork();
    }, this.logFailure('filter flag not recorded'));
  }

  async message(
    socket: IoSocket,
    { sessionId, clientId, text }: ClientPayload<'random:message'>,
  ): Promise<Ack<AckData<'random:message'>>> {
    const found = this.liveFor(socket, sessionId);
    if (!found) return ackError('NOT_FOUND', MESSAGES.ended);
    const { session, me, partner } = found;
    // A re-send of something already relayed (the first answer was lost on the way).
    if (me.clientIds.includes(clientId)) return ackOk({ clientId });

    const contact = findContactDetails(text);
    if (contact) {
      this.deps.metrics.increment('ss_random_refused_total', { kind: contact });
      return ackError('CONTENT_BLOCKED', contact === 'link' ? MESSAGES.link : MESSAGES.contact);
    }
    const verdict = moderateText(text, 'random');
    if (verdict.severity > 0) {
      this.deps.metrics.increment('ss_filter_hits_total', { severity: String(verdict.severity) });
    }
    const now = Date.now();
    if (verdict.action === 'block') {
      this.remember(session, {
        senderId: me.userId,
        clientId,
        text,
        shown: '',
        atMs: now,
        delivered: false,
      });
      await this.flag(me.userId, 'high', verdict.categories, session.id);
      await this.finish(session, 'filter', me.userId);
      await this.automaticTimeout(me, 'filter');
      return ackError('CONTENT_BLOCKED', MESSAGES.blocked);
    }

    me.clientIds.push(clientId);
    if (me.clientIds.length > CLIENT_IDS_KEPT) me.clientIds.shift();
    this.remember(session, {
      senderId: me.userId,
      clientId,
      text,
      shown: verdict.text,
      atMs: now,
      delivered: true,
    });
    this.armSilenceTimer(session);
    const at = new Date(now).toISOString();
    const relayed = { sessionId, clientId, text: verdict.text, at };
    this.send(partner, 'random:message', { ...relayed, from: 'them' });
    // The sender gets it back as everyone sees it (a masked word is masked for them too).
    this.send(me, 'random:message', { ...relayed, from: 'me' });
    this.deps.metrics.increment('ss_random_messages_total');
    if (verdict.flag) void this.flag(me.userId, 'medium', verdict.categories, session.id);
    return ackOk({ clientId });
  }

  typing(socket: IoSocket, { sessionId, typing }: ClientPayload<'random:typing'>): void {
    const found = this.liveFor(socket, sessionId);
    if (found) this.send(found.partner, 'random:typing', { sessionId, typing });
  }

  // Reports, blocks and automatic timeouts -----------------------------------------------------------

  private async automaticTimeout(
    target: Pick<Participant, 'userId' | 'guest' | 'ip'>,
    cause: AutomaticTimeoutCause,
    reportId?: string,
  ): Promise<void> {
    try {
      const result = await applyAutomaticRandomTimeout(this.deps.db, {
        targetUserId: target.userId,
        cause,
        ...(reportId && { reportId }),
        ipHash: target.guest ? this.hashIp(target.ip) : null,
      });
      this.deps.afterDatabaseWork();
      if (!result.applied) return;
      this.deps.metrics.increment('ss_random_timeouts_total', { cause });
      // Announced exactly like a moderator's decision (internal event `user.sanctioned`).
      await applyInternalEvent(
        { io: this.deps.io, db: this.deps.db, random: this },
        {
          id: randomUUID(),
          at: new Date().toISOString(),
          type: 'user.sanctioned',
          userId: target.userId,
          kind: 'random_timeout',
          reason: result.sanction.reason,
          until: result.sanction.expiresAt?.toISOString() ?? null,
        },
      );
    } catch (error) {
      this.logFailure('automatic timeout not applied')(error);
    }
  }

  async report(
    socket: IoSocket,
    payload: { sessionId: string; reason: ReportReason; details?: string | undefined },
  ): Promise<Ack<AckData<'random:report'>>> {
    const { db } = this.deps;
    const { userId } = socket.data;
    const found = this.knownFor(socket, payload.sessionId);
    if (!found) return ackError('NOT_FOUND', MESSAGES.reportLate);
    const { session, partner } = found;
    const rate = await hitRateLimit(db, `report:${userId}`, LIMITS.report.perHour, 3600);
    if (!rate.allowed) return ackError('RATE_LIMITED', MESSAGES.reportRate, rate.retryAfterMs);

    await this.finish(session, 'report', userId);
    const result = await createRandomReport(db, {
      reporterId: userId,
      sessionId: session.id,
      reason: payload.reason,
      details: payload.details ?? '',
      messages: session.buffer.map((m) => ({
        senderId: m.senderId,
        text: m.text,
        at: new Date(m.atMs),
        delivered: m.delivered,
      })),
    });
    this.deps.afterDatabaseWork();
    if (!result.ok) {
      return result.reason === 'not_found'
        ? ackError('NOT_FOUND', MESSAGES.reportLate)
        : ackError('FORBIDDEN', MESSAGES.account);
    }
    if (!result.duplicate) {
      this.deps.metrics.increment('ss_random_reports_total');
      if (result.distinctReporters >= LIMITS.random.reportsForTimeout) {
        await this.automaticTimeout(partner, 'reports', result.reportId);
      }
    }
    return ackOk({ reportId: result.reportId });
  }

  async block(socket: IoSocket, sessionId: string): Promise<Ack<AckData<'random:block'>>> {
    const { db, io } = this.deps;
    const { userId, guest } = socket.data;
    const found = this.knownFor(socket, sessionId);
    if (!found) return ackError('NOT_FOUND', MESSAGES.ended);
    const { session, partner } = found;
    // The other person sees an ordinary ending, never "you were blocked".
    await this.finish(session, 'end', userId);
    if (guest) {
      const avoid = this.guestAvoid.get(userId) ?? new Set<string>();
      avoid.add(partner.userId);
      this.guestAvoid.set(userId, avoid);
    } else {
      const result = await blockUser(db, userId, partner.userId);
      this.deps.afterDatabaseWork();
      if (result.ok) {
        await applyInternalEvent(
          { io, db, random: this },
          {
            id: randomUUID(),
            at: new Date().toISOString(),
            type: 'block.created',
            blockerId: userId,
            blockedId: partner.userId,
          },
        );
      }
    }
    this.deps.metrics.increment('ss_random_blocks_total');
    return ackOk({});
  }

  // Sharing profiles and adding contacts --------------------------------------------------------------

  /**
   * "Share profile" and "Add contact" (RAND-08): nothing is shown or stored until both people
   * asked for the same thing. Guests cannot take part (D-025).
   */
  async offer(
    socket: IoSocket,
    { sessionId, offer }: ClientPayload<'random:offer'>,
    accepting: boolean,
  ): Promise<Ack<AckData<'random:offer'>>> {
    const { db } = this.deps;
    const found = this.liveFor(socket, sessionId);
    if (!found) return ackError('NOT_FOUND', MESSAGES.ended);
    const { session, me, partner } = found;
    if (me.guest || partner.guest) return ackError('FORBIDDEN', MESSAGES.guests);
    if (session.done.has(offer)) return ackOk({});
    const wants = session.wants[offer];
    if (accepting && !wants.has(partner.userId)) {
      return ackError('CONFLICT', MESSAGES.nothingToAccept);
    }
    wants.add(me.userId);
    if (!wants.has(partner.userId)) {
      this.send(partner, 'random:offered', { sessionId, offer });
      return ackOk({});
    }

    // Both agreed.
    session.done.add(offer);
    if (offer === 'add_contact') {
      const result = await addRandomContact(db, me.userId, partner.userId);
      if (!result.ok) {
        session.done.delete(offer);
        wants.clear();
        return ackError('FORBIDDEN', MESSAGES.contactRefused);
      }
    } else {
      await bumpMetric(db, 'random_profile_shared');
    }
    if (!session.profilesShared) {
      session.profilesShared = true;
      const people = new Map(
        (await getPersonRows(db, [me.userId, partner.userId])).map((p) => [p.id, p]),
      );
      for (const to of [me, partner]) {
        const other = people.get(partnerOf(session, to.userId).userId);
        if (!other) continue;
        const { id, nickname, avatar } = nicknameOnly(other);
        this.send(to, 'random:shared', { sessionId, profile: { id, nickname, avatar } });
      }
    }
    if (offer === 'add_contact') {
      for (const to of [me, partner]) this.send(to, 'random:contact-added', { sessionId });
    }
    this.deps.afterDatabaseWork();
    return ackOk({});
  }

  // Connections coming and going -------------------------------------------------------------------

  /** A tab that lost its connection picks its chat up again (within the 15-second grace period). */
  resume(socket: IoSocket, sessionId: string): Ack<AckData<'random:resume'>> {
    const { userId } = socket.data;
    const session = this.live.get(sessionId);
    const me = session ? participantOf(session, userId) : null;
    if (!session || !me) return ackError('NOT_FOUND', MESSAGES.ended);
    if (me.socketId !== socket.id && this.isConnected(me.socketId)) {
      return ackError('CONFLICT', MESSAGES.otherTab);
    }
    me.socketId = socket.id;
    if (me.graceTimer) clearTimeout(me.graceTimer);
    me.graceTimer = null;
    return ackOk({
      sessionId,
      sharedInterests: session.sharedInterests,
      messages: session.buffer
        .filter((m) => m.delivered)
        .map((m) => ({
          sessionId,
          clientId: m.clientId,
          text: m.shown,
          from: m.senderId === userId ? ('me' as const) : ('them' as const),
          at: new Date(m.atMs).toISOString(),
        })),
    });
  }

  /** A connection closed: stop waiting; a chat gets 15 seconds for the tab to come back. */
  socketClosed(socket: IoSocket): void {
    const { userId } = socket.data;
    if (this.queue.get(userId)?.socketId === socket.id) this.queue.remove(userId);
    const sessionId = this.byUser.get(userId);
    const session = sessionId ? this.live.get(sessionId) : undefined;
    const me = session ? participantOf(session, userId) : null;
    if (!session || me?.socketId !== socket.id) return;
    me.socketId = null;
    me.graceTimer = setTimeout(() => {
      void this.finish(session, 'disconnect', userId);
    }, this.timings.reconnectGraceMs);
    me.graceTimer.unref();
  }

  /** The person may no longer use random mode (timeout, mute, suspension, ban): out at once. */
  removeUser(userId: string): void {
    this.queue.remove(userId);
    const starting = this.starting.get(userId);
    if (starting) starting.cancelled = true;
    const sessionId = this.byUser.get(userId);
    const session = sessionId ? this.live.get(sessionId) : undefined;
    if (session) void this.finish(session, 'end', null);
  }

  /** One person blocked another (anywhere in the app): they leave each other's random chat. */
  blockCreated(blockerId: string, blockedId: string): void {
    this.queue.avoidEachOther(blockerId, blockedId);
    const sessionId = this.byUser.get(blockerId);
    const session = sessionId ? this.live.get(sessionId) : undefined;
    if (session && participantOf(session, blockedId)) void this.finish(session, 'end', blockerId);
  }

  /** Memory housekeeping (once a minute); it never touches the database. */
  sweep(): void {
    const now = Date.now();
    this.queue.sweep(now);
    for (const [userId, state] of this.skips) {
      if (state.untilMs <= now && state.fast === 0) this.skips.delete(userId);
    }
    for (const userId of this.guestAvoid.keys()) {
      const connected = this.deps.io.sockets.adapter.rooms.get(rooms.user(userId));
      if (!connected || connected.size === 0) this.guestAvoid.delete(userId);
    }
  }

  /** Server shutdown: chats cannot continue without this memory, so they are recorded as ended. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    await Promise.all([...this.live.values()].map((s) => this.finish(s, 'disconnect', null)));
    for (const session of this.retained.values()) {
      if (session.dropTimer) clearTimeout(session.dropTimer);
    }
    this.retained.clear();
  }
}
