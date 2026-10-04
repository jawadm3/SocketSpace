/**
 * @socketspace/shared: the one typed definition of every real-time event and API payload, plus the
 * rules both apps must agree on (limits, vocabularies, names and avatars, authorisation).
 *
 * Import a focused entry point where possible (for example `@socketspace/shared/events`), so
 * browser bundles only include what they use.
 *
 * The word-list filter is deliberately not re-exported here: it is server-side only
 * (`@socketspace/shared/moderation`), so the word list never reaches a browser bundle.
 */
export const APP_NAME = 'SocketSpace';

export * from './authz';
export * from './domain';
export * from './emoji';
export * from './errors';
export * from './events';
export * from './internal-events';
export * from './limits';
export * from './media';
export * from './primitives';
export * from './profile';
export * from './realtime-token';
export * from './reports';
export * from './text';
