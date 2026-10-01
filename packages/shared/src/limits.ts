/**
 * Size and rate limits, defined once and used by the Zod contracts, the database check constraints
 * and the realtime server. Values come from docs/architecture/realtime-protocol.md and
 * docs/architecture/security.md; rate limits are initial values, tuned in Stage G.
 */
export const LIMITS = {
  /** Socket.IO rejects any single packet larger than this (maxHttpBufferSize). */
  packetBytes: 16 * 1024,

  message: {
    /** Characters (Unicode code points) per community message. */
    bodyMaxChars: 4000,
    attachmentsMax: 10,
    /** Authors can edit their own message for this long. */
    editWindowMs: 24 * 60 * 60 * 1000,
    distinctReactionsMax: 20,
  },

  sync: {
    /** Conversations per sync:request. */
    cursorsMax: 50,
    /** Events returned per conversation; beyond this the client reloads over HTTP. */
    eventsPerConversation: 200,
  },

  profile: {
    nicknameMin: 3,
    nicknameMax: 24,
    realNameMax: 60,
    bioMax: 160,
  },

  room: {
    slugMin: 3,
    slugMax: 32,
    nameMax: 50,
    topicMax: 200,
  },

  random: {
    textMaxChars: 1000,
    interestsMax: 5,
    interestMinChars: 2,
    interestMaxChars: 24,
  },

  report: {
    detailsMax: 1000,
  },

  password: {
    min: 10,
    max: 128,
  },

  connections: {
    perUser: 10,
    perIp: 20,
    newPerIpPerMinute: 30,
  },

  realtimeToken: {
    /** Lifetime of the signed token a browser uses to connect to the realtime server. */
    ttlSeconds: 5 * 60,
    audience: 'socketspace-realtime',
  },
} as const;

/** Token-bucket settings: `burst` tokens at most, refilled at `perSecond`. */
export interface BucketSpec {
  readonly burst: number;
  readonly perSecond: number;
}

/** Per-socket event limits (realtime-protocol.md, "Rate limits and abuse limits"). */
export const RATE_LIMITS = {
  'message:send': { burst: 10, perSecond: 1 },
  'message:edit': { burst: 30, perSecond: 30 / 60 },
  'message:delete': { burst: 30, perSecond: 30 / 60 },
  'reaction:toggle': { burst: 60, perSecond: 1 },
  'typing:set': { burst: 1, perSecond: 0.5 },
  'sync:request': { burst: 6, perSecond: 6 / 60 },
  'read:update': { burst: 30, perSecond: 2 },
  'delivery:ack': { burst: 10, perSecond: 1 },
  'presence:set': { burst: 5, perSecond: 0.2 },
} as const satisfies Record<string, BucketSpec>;

/** 20 rate-limit violations within this window disconnects the socket. */
export const ABUSE = {
  violationsBeforeDisconnect: 20,
  violationWindowMs: 60_000,
} as const;
