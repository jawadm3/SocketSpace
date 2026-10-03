'use client';

/**
 * The live parts of the notifications page: marking everything seen once the page is open, and
 * switching browser notifications on or off (NOTIF-02).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';

import { useChat } from '@/lib/chat/provider';
import {
  browserNotificationsOn,
  browserNotificationsSupported,
  switchOffBrowserNotifications,
  switchOnBrowserNotifications,
} from '@/lib/chat/notifications';

import { markNotificationsReadAction } from '../social-actions';

/** Opening the page counts as seeing everything on it: the bell goes back to zero. */
export function MarkSeen({ unread }: { unread: number }) {
  const { clearNotificationCount } = useChat();
  useEffect(() => {
    if (unread === 0) return;
    clearNotificationCount();
    void markNotificationsReadAction();
  }, [unread, clearNotificationCount]);
  return null;
}

const subscribeNever = () => () => undefined;

export function BrowserNotificationsToggle() {
  const supported = useSyncExternalStore(
    subscribeNever,
    browserNotificationsSupported,
    () => false,
  );
  const initiallyOn = useSyncExternalStore(subscribeNever, browserNotificationsOn, () => false);
  const [on, setOn] = useState<boolean | null>(null);
  const [message, setMessage] = useState('');
  const enabled = on ?? initiallyOn;
  if (!supported) return null;
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-line bg-card p-3 text-sm">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          onChange={(event) => {
            if (!event.target.checked) {
              switchOffBrowserNotifications();
              setOn(false);
              setMessage('');
              return;
            }
            void switchOnBrowserNotifications().then((result) => {
              setOn(result === 'on');
              setMessage(
                result === 'denied'
                  ? 'Your browser blocked notifications. You can allow them in its site settings.'
                  : '',
              );
            });
          }}
          className="mt-0.5 h-5 w-5 accent-[var(--color-accent)]"
        />
        <span>
          <span className="font-semibold">Browser notifications</span>
          <span className="block text-ink-2">
            Shown only while SocketSpace is in a hidden tab, and never with message text.
          </span>
        </span>
      </label>
      <p role="status" className="min-h-4 text-ink-2">
        {message}
      </p>
    </div>
  );
}
