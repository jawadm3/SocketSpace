/**
 * The two account emails, in plain English, as text and as simple HTML.
 * Everything inserted into HTML is escaped.
 */
import type { EmailMessage } from './index';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(
  title: string,
  paragraphs: string[],
  button: { label: string; url: string },
): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${escapeHtml(p)}</p>`).join('');
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#1d2433;max-width:520px;margin:0 auto;padding:24px">
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>${body}
<p style="margin:24px 0"><a href="${escapeHtml(button.url)}" style="background:#1f3a8a;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">${escapeHtml(button.label)}</a></p>
<p style="font-size:13px;color:#5b6475">If the button does not work, copy this address into your browser:<br>${escapeHtml(button.url)}</p>
</body></html>`;
}

export function verifyEmailMessage(to: string, url: string): EmailMessage {
  const paragraphs = [
    'Welcome to SocketSpace! Please confirm this is your email address.',
    'Until you confirm, you can read conversations but not post.',
    'If you did not create an account, you can ignore this email.',
  ];
  return {
    kind: 'verify-email',
    to,
    subject: 'Confirm your email for SocketSpace',
    text: `${paragraphs.join('\n\n')}\n\nConfirm your email: ${url}\n`,
    html: layout('Confirm your email', paragraphs, { label: 'Confirm my email', url }),
  };
}

export function resetPasswordMessage(to: string, url: string): EmailMessage {
  const paragraphs = [
    'Someone (hopefully you) asked to reset the password for your SocketSpace account.',
    'The link works once and expires in 30 minutes. Resetting signs you out everywhere.',
    'If you did not ask for this, ignore this email; your password stays the same.',
  ];
  return {
    kind: 'reset-password',
    to,
    subject: 'Reset your SocketSpace password',
    text: `${paragraphs.join('\n\n')}\n\nChoose a new password: ${url}\n`,
    html: layout('Reset your password', paragraphs, { label: 'Choose a new password', url }),
  };
}
