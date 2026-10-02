/**
 * Sending email. One interface, three drivers:
 *
 * - `resend`: the Resend HTTP API (production, decision D-014). No SDK needed.
 * - `file`: writes each email as a JSON file in DEV_MAIL_DIR (default <repo>/.cache/dev-mail).
 *   This is the local "mail catcher": nothing leaves the computer, and /dev/mail shows the files.
 * - `memory`: keeps emails in an array, for automated tests.
 *
 * Email bodies contain sign-in links, so drivers never log them.
 */
import 'server-only';

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Machine-readable kind, for tests and the dev mail page (not sent to providers). */
  kind: 'verify-email' | 'reset-password';
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export class MemoryEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];

  send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  /** The most recent email to `to`, if any. */
  latestTo(to: string): EmailMessage | undefined {
    return this.sent.filter((m) => m.to === to.toLowerCase() || m.to === to).at(-1);
  }
}

/** The default local mail folder: <repo>/.cache/dev-mail (on the D: drive, git-ignored). */
export function defaultDevMailDir(): string {
  // apps/web is two levels below the repository root.
  return resolve(process.cwd(), '..', '..', '.cache', 'dev-mail');
}

export class FileEmailSender implements EmailSender {
  constructor(private readonly dir: string) {}

  async send(message: EmailMessage): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeTo = message.to.replace(/[^a-z0-9@._-]/gi, '_');
    const file = join(this.dir, `${stamp}-${message.kind}-${safeTo}.json`);
    await writeFile(
      file,
      JSON.stringify({ ...message, savedAt: new Date().toISOString() }, null, 2),
    );
  }
}

export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      // The status is enough to diagnose; the response body could echo the address.
      throw new Error(`Resend refused the email (HTTP ${String(response.status)})`);
    }
  }
}

export function createEmailSender(options: {
  driver: 'resend' | 'file' | 'memory';
  from: string;
  resendApiKey?: string | undefined;
  devMailDir?: string | undefined;
}): EmailSender {
  switch (options.driver) {
    case 'resend':
      if (!options.resendApiKey)
        throw new Error('RESEND_API_KEY is required for the resend driver');
      return new ResendEmailSender(options.resendApiKey, options.from);
    case 'file':
      return new FileEmailSender(options.devMailDir ?? defaultDevMailDir());
    case 'memory':
      return new MemoryEmailSender();
  }
}
