import Link from 'next/link';

import { buttonClasses } from '@/components/ui';
import { getWebEnv } from '@/server/env';

/** Placeholder home page. The animated home page is built in Stage F (HOME-01 to HOME-05). */
export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="airmail-stripe h-2 w-full" aria-hidden="true" />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-4 py-16">
        <p className="w-fit -rotate-2 rounded-md border-2 border-dashed border-ink px-3 py-1 text-xs font-bold uppercase tracking-widest">
          Say hello
        </p>
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
          Real-time rooms, direct messages, and a safer way to meet someone new.
        </h1>
        <p className="max-w-xl text-lg text-ink-2">
          SocketSpace is a chat platform built as a portfolio project. Create an account to pick a
          nickname and a profile picture.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/sign-up" className={buttonClasses('primary', 'text-base')}>
            Create an account
          </Link>
          <Link href="/sign-in" className={buttonClasses('secondary', 'text-base')}>
            Sign in
          </Link>
          {getWebEnv().RANDOM_MODE_ENABLED ? (
            <Link href="/random" className={buttonClasses('ghost', 'text-base underline')}>
              Try random chat as a guest (18+)
            </Link>
          ) : null}
        </div>
      </main>
    </div>
  );
}
