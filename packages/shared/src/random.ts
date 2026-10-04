/**
 * Random-match mode: the rules a person accepts at the 18+ gate (RAND-02, security.md 4.3).
 *
 * The rules are versioned. The version a person accepted is stored on their account; when the
 * rules change, `RANDOM_RULES_VERSION` changes with them and everyone is asked again.
 * The web app shows the rules and records the acceptance; the realtime server refuses
 * `random:join` until the current version is accepted.
 */

/** Change this whenever `RANDOM_RULES` changes in meaning. */
export const RANDOM_RULES_VERSION = '2026-10-04';

export const RANDOM_RULES: readonly string[] = [
  'Random chat is for adults only. You must be 18 or older.',
  'It is text only. Links, pictures, phone numbers, email addresses and usernames on other apps are not allowed.',
  'Be respectful. Harassment, hate, threats and sexual messages nobody asked for are not allowed.',
  'You are "Stranger" to each other. Your profile is shown only if both of you agree to share it.',
  'Chats are not saved. If someone reports a chat, its last 20 messages are kept for a moderator.',
  'Breaking the rules pauses random chat for you: 1 hour after a blocked message, 24 hours after reports from three different people.',
];

export interface RandomGateRecord {
  adultConfirmedAt: Date | string | null;
  termsVersion: string | null;
}

/** True when the person confirmed they are an adult and accepted the rules now in force. */
export function isRandomGateAccepted(gate: RandomGateRecord | null | undefined): boolean {
  return (
    gate !== null &&
    gate !== undefined &&
    gate.adultConfirmedAt !== null &&
    gate.termsVersion === RANDOM_RULES_VERSION
  );
}

/** The aggregate counters of random mode (`metric_daily`; RAND-09). Counts only, never user IDs. */
export const RANDOM_METRICS = [
  'random_sessions_started',
  'random_reports',
  'random_profile_shared',
  'random_mutual_contact_added',
  'random_room_cta_clicked',
  'room_joined_after_random',
] as const;

export type RandomMetric = (typeof RANDOM_METRICS)[number];
