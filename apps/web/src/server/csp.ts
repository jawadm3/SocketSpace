/**
 * The Content Security Policy (security.md 3.5): a list the browser enforces of where scripts,
 * styles, images and connections may come from. Scripts need this request's nonce, so an injected
 * <script> cannot run.
 *
 * `style-src 'unsafe-inline'` is a known compromise: server-rendered `style` attributes (used by
 * React and animation libraries) would otherwise be blocked. Revisited in Stage G.
 */
export function buildCsp(options: {
  nonce: string;
  realtimeUrl: string;
  isDev: boolean;
  https: boolean;
}): string {
  const realtime = new URL(options.realtimeUrl);
  const websocket = `${realtime.protocol === 'https:' ? 'wss' : 'ws'}://${realtime.host}`;
  const directives = [
    `default-src 'self'`,
    // In development React uses eval() to rebuild server error stacks; never in production.
    `script-src 'self' 'nonce-${options.nonce}' 'strict-dynamic'${options.isDev ? ` 'unsafe-eval'` : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self' ${realtime.origin} ${websocket}`,
    `frame-ancestors 'none'`,
    `base-uri 'none'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `worker-src 'self' blob:`,
    `manifest-src 'self'`,
  ];
  if (options.https) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

/** 128 random bits, base64-encoded: a fresh nonce for every page request. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
