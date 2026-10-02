import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Card } from '@/components/ui';
import { defaultDevMailDir } from '@/server/email';
import { getWebEnv } from '@/server/env';

export const metadata: Metadata = { title: 'Local mail' };

interface SavedMail {
  file: string;
  to: string;
  subject: string;
  text: string;
  savedAt: string;
}

/**
 * The local "mail catcher": shows emails the `file` driver saved, newest first.
 * Exists only in development with EMAIL_DRIVER=file; everywhere else it is a 404.
 */
export default async function DevMailPage() {
  const env = getWebEnv();
  if (env.NODE_ENV !== 'development' || env.EMAIL_DRIVER !== 'file') notFound();

  const dir = env.DEV_MAIL_DIR ?? defaultDevMailDir();
  let files: string[];
  try {
    files = (await readdir(dir))
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, 30);
  } catch {
    files = [];
  }
  const mails = await Promise.all(
    files.map(async (file) => ({
      file,
      ...(JSON.parse(await readFile(join(dir, file), 'utf8')) as Omit<SavedMail, 'file'>),
    })),
  );

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-10">
      <h1 className="text-2xl font-extrabold tracking-tight">Local mail ({mails.length})</h1>
      <p className="text-sm text-muted">Development only. Emails are saved in {dir}.</p>
      {mails.map((mail) => (
        <Card key={mail.file}>
          <p className="text-sm text-muted">
            To {mail.to} · {mail.savedAt}
          </p>
          <h2 className="mt-1 font-bold">{mail.subject}</h2>
          {/* Plain text only: links are made clickable, nothing is rendered as HTML. */}
          <div className="mt-3 whitespace-pre-wrap break-words text-sm">
            {mail.text.split(/(https?:\/\/\S+)/g).map((part, index) =>
              /^https?:\/\//.test(part) ? (
                <a key={index} href={part} className="text-accent underline">
                  {part}
                </a>
              ) : (
                <span key={index}>{part}</span>
              ),
            )}
          </div>
        </Card>
      ))}
    </main>
  );
}
