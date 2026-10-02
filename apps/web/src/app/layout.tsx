import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';

import { THEME_COOKIE, parseThemeCookie } from '@/lib/theme';

import './globals.css';

export const metadata: Metadata = {
  title: { default: 'SocketSpace', template: '%s · SocketSpace' },
  description: 'Real-time rooms, direct messages and a safer way to meet someone new.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f3f4ef' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1729' },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { theme, mode } = parseThemeCookie((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en-GB" data-theme={theme} data-mode={mode}>
      <body className="bg-surface text-ink">{children}</body>
    </html>
  );
}
