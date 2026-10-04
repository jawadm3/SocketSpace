/**
 * Notification wording and browser notifications (NOTIF-01, NOTIF-02).
 *
 * Browser notifications are opt-in twice over: the person switches them on here, and the browser
 * asks for permission. They only appear while the SocketSpace tab is hidden, and never contain
 * message text (a lock screen may show them to anyone nearby).
 */
export type NotificationKind =
  'mention' | 'reply' | 'dm' | 'invite' | 'contact_request' | 'moderation';

const OPT_IN_KEY = 'socketspace:browser-notifications';

/** "ava mentioned you in #design", in plain words. */
export function describeNotification(
  kind: NotificationKind,
  actor: string | null,
  place: string | null,
): string {
  const who = actor ?? 'Someone';
  const where = place ? ` in ${place}` : '';
  switch (kind) {
    case 'mention':
      return `${who} mentioned you${where}`;
    case 'reply':
      return `${who} replied to you${where}`;
    case 'dm':
      return `${who} sent you a message`;
    case 'invite':
      return `${who} invited you to a room`;
    case 'contact_request':
      return `${who} wants to add you as a contact`;
    case 'moderation':
      return 'A message from the moderators';
  }
}

export type ModerationNoticeKind =
  | 'warned'
  | 'muted'
  | 'unmuted'
  | 'suspended'
  | 'banned'
  | 'random_timeout'
  | 'random_timeout_lifted';

/**
 * What a person reads when a site moderator acts on their account (ADMIN-03): what happened, until
 * when, and the moderator's reason. `until` is already written in the reader's own time.
 */
export function describeModerationNotice(
  kind: ModerationNoticeKind,
  reason: string,
  until: string | null,
): string {
  const when = until ? ` until ${until}` : '';
  const why = reason ? ` Reason: ${reason}` : '';
  switch (kind) {
    case 'warned':
      return `A moderator sent you a warning.${why}`;
    case 'muted':
      return `A moderator muted your account${when}. You can still read.${why}`;
    case 'unmuted':
      return 'You can post again.';
    case 'suspended':
      return `Your account was suspended${when}.${why}`;
    case 'banned':
      return `Your account was banned${when}.${why}`;
    case 'random_timeout':
      return `You cannot use random chat${when}.${why}`;
    case 'random_timeout_lifted':
      return 'You can use random chat again.';
  }
}

export function browserNotificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/** Switched on here and allowed by the browser. */
export function browserNotificationsOn(): boolean {
  if (!browserNotificationsSupported()) return false;
  try {
    return localStorage.getItem(OPT_IN_KEY) === 'on' && Notification.permission === 'granted';
  } catch {
    return false;
  }
}

/** Asks the browser for permission and remembers the choice; returns what happened. */
export async function switchOnBrowserNotifications(): Promise<'on' | 'denied' | 'unsupported'> {
  if (!browserNotificationsSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  try {
    localStorage.setItem(OPT_IN_KEY, 'on');
  } catch {
    // Storage blocked: the setting lasts for this page only.
  }
  return 'on';
}

export function switchOffBrowserNotifications(): void {
  try {
    localStorage.removeItem(OPT_IN_KEY);
  } catch {
    // Nothing saved.
  }
}

/** Shows a notification if the person opted in and the tab is hidden. */
export function showBrowserNotification(id: string, text: string): void {
  if (document.visibilityState !== 'hidden' || !browserNotificationsOn()) return;
  try {
    new Notification('SocketSpace', { body: text, tag: id });
  } catch {
    // Some browsers only allow notifications from a service worker; skip quietly.
  }
}
