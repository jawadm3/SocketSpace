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

  upload: {
    /** Largest file accepted (security.md 3.7). Vercel functions accept bodies up to 4.5 MB. */
    maxBytes: 4 * 1024 * 1024,
    /** Largest picture decoded, in pixels (width x height). */
    maxPixels: 25_000_000,
    /** Uploads per person per hour. */
    perHour: 20,
    /** Message images are scaled down to fit a square of this many pixels. */
    imageMaxEdge: 1600,
    /** Avatar photos are cropped to a square of this many pixels. */
    avatarEdge: 256,
  },

  linkPreview: {
    /** Links per message that get a preview (the first ones). */
    perMessage: 3,
    titleMax: 200,
    descriptionMax: 300,
    siteNameMax: 80,
    /** A fetched preview is reused for this long (security.md 3.8). */
    ttlSeconds: 7 * 24 * 60 * 60,
    /** A link that could not be fetched is tried again after this long. */
    errorTtlSeconds: 60 * 60,
    maxBytes: 512 * 1024,
    timeoutMs: 3000,
    maxRedirects: 3,
    /** New fetches one person may cause per minute (cached previews are free). */
    fetchesPerMinute: 20,
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
