import Link from 'next/link';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="airmail-stripe h-2 w-full" aria-hidden="true" />
      <header className="mx-auto w-full max-w-5xl px-4 py-5">
        <Link href="/" className="text-lg font-extrabold tracking-tight text-ink">
          SocketSpace
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pb-16 pt-4">
        {children}
      </main>
    </div>
  );
}
