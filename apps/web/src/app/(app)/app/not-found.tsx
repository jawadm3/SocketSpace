import Link from 'next/link';

import { buttonClasses, Card } from '@/components/ui';

/**
 * Shown inside the app shell when a room does not exist, was deleted, or is private and you are
 * not in it. The three cases look the same on purpose, so nothing about private rooms leaks.
 */
export default function AppNotFound() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-10">
      <Card>
        <h1 className="text-2xl font-extrabold tracking-tight">Room not found</h1>
        <p className="mt-2 text-ink-2">
          It may have been deleted, or it is private and you need an invite to see it.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/app" className={buttonClasses('primary')}>
            Back to your rooms
          </Link>
          <Link href="/app/explore" className={buttonClasses('secondary')}>
            Explore public rooms
          </Link>
        </div>
      </Card>
    </main>
  );
}
