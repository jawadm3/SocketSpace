/**
 * The link-preview fetcher against hostile addresses and servers (MSG-08, SEC-07, journey J9):
 * private and special addresses in every spelling, redirects into the private network, DNS
 * rebinding, slow and oversized answers.
 *
 * A small web server on this computer plays "the internet". Fake host names resolve to made-up
 * public addresses; the `dial` option (tests only) says where such an address is really reached.
 * `hits` records every request that arrived, so a test can prove nothing was fetched.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { checkUrl, isPublicAddress } from './address';
import { decodeEntities, extractPreview, parseAttributes } from './extract';
import { safeFetchHtml, type ResolvedAddress, type SafeFetchOptions } from './safe-fetch';

const PUBLIC_IP = '93.184.216.34';
let server: Server;
let port: number;
let hits: string[] = [];

const page = (title: string) =>
  `<!doctype html><html><head><title>${title}</title></head><body>hello</body></html>`;

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = request.url ?? '/';
    hits.push(`${request.headers.host ?? ''}${url}`);
    const html = (body: string, headers: Record<string, string> = {}) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...headers });
      response.end(body);
    };
    const redirect = (location: string) => {
      response.writeHead(302, { location });
      response.end();
    };
    if (url === '/page') html(page('A page'));
    else if (url === '/to-metadata') redirect('http://169.254.169.254/latest/meta-data/');
    else if (url === '/to-localhost') redirect('http://localhost:3000/');
    else if (url === '/to-private-name') redirect('http://internal.example/secret');
    else if (url === '/to-file') redirect('file:///etc/passwd');
    else if (url === '/to-port') redirect('http://good.example:8080/page');
    else if (url === '/relative') redirect('/page');
    else if (url.startsWith('/loop')) redirect(`/loop${String(Number(url.slice(5) || '0') + 1)}`);
    else if (url === '/hop1') redirect('http://second.example/hop2');
    else if (url === '/hop2') redirect('http://good.example/page');
    else if (url === '/json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"title":"no"}');
    } else if (url === '/missing') {
      response.writeHead(404, { 'content-type': 'text/html' });
      response.end(page('Not here'));
    } else if (url === '/gzip') html('not really gzip', { 'content-encoding': 'gzip' });
    else if (url === '/slow') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.write('<title>Slow');
      // Never finishes.
    } else if (url === '/never') {
      // Never answers at all.
    } else if (url === '/big') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.write(page('Big page'));
      const filler = 'x'.repeat(64 * 1024);
      const pump = () => {
        while (response.write(filler)) {
          // keep going until the socket pushes back
        }
        response.once('drain', pump);
      };
      response.on('error', () => undefined);
      response.on('close', () => response.removeAllListeners('drain'));
      pump();
    } else if (url === '/latin1') {
      response.writeHead(200, { 'content-type': 'text/html; charset=iso-8859-1' });
      response.end(Buffer.from('<title>Café</title>', 'latin1'));
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
});

beforeEach(() => {
  hits = [];
});

/** "DNS" for the tests. */
const names: Record<string, ResolvedAddress[]> = {
  'good.example': [{ address: PUBLIC_IP, family: 4 }],
  'second.example': [{ address: '93.184.216.35', family: 4 }],
  'internal.example': [{ address: '10.0.0.5', family: 4 }],
  'metadata.example': [{ address: '169.254.169.254', family: 4 }],
  'loopback6.example': [{ address: '::1', family: 6 }],
  'mapped.example': [{ address: '::ffff:127.0.0.1', family: 6 }],
  'mixed.example': [
    { address: PUBLIC_IP, family: 4 },
    { address: '192.168.1.10', family: 4 },
  ],
};

function options(extra: SafeFetchOptions = {}): SafeFetchOptions & { lookups: string[] } {
  const lookups: string[] = [];
  return {
    lookups,
    lookup: (hostname) => {
      lookups.push(hostname);
      const found = names[hostname];
      return found ? Promise.resolve(found) : Promise.reject(new Error('ENOTFOUND'));
    },
    // Every checked public address is "reached" at the test server.
    dial: () => ({ host: '127.0.0.1', port }),
    ...extra,
  };
}

describe('which addresses are public', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '0.0.0.0',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '192.0.0.8',
    '192.0.2.1',
    '198.18.0.1',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    '::ffff:7f00:1',
    '64:ff9b::7f00:1',
    'fc00::1',
    'fd12:3456:789a::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '2001:0::1',
    '2002:7f00:1::1',
    '100::1',
    'not an address',
    '',
  ])('refuses %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    '93.184.216.34',
    '1.1.1.1',
    '172.15.0.1',
    '172.32.0.1',
    '2606:4700:4700::1111',
    '2a00:1450:4009::200e',
  ])('allows %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});

describe('checks that need no network', () => {
  it.each([
    ['http://169.254.169.254/latest/meta-data/', 'private_address'],
    ['http://localhost:3000', 'port'],
    ['http://localhost/', 'private_address'],
    ['http://127.0.0.1/', 'private_address'],
    // The same loopback address written as one number, in octal, in hex and shortened.
    ['http://2130706433/', 'private_address'],
    ['http://0177.0.0.1/', 'private_address'],
    ['http://0x7f.0.0.1/', 'private_address'],
    ['http://127.1/', 'private_address'],
    ['http://[::1]/', 'private_address'],
    ['http://[::ffff:127.0.0.1]/', 'private_address'],
    ['http://[fe80::1]/', 'private_address'],
    ['http://intranet/', 'private_address'],
    ['http://printer.local/', 'private_address'],
    ['http://db.internal/', 'private_address'],
    ['http://app.localhost/', 'private_address'],
    ['http://good.example:8080/', 'port'],
    ['https://good.example:80/', 'port'],
    ['http://user:secret@good.example/', 'credentials'],
    ['ftp://good.example/', 'scheme'],
    ['file:///etc/passwd', 'scheme'],
    ['gopher://good.example/', 'scheme'],
    ['javascript:alert(1)', 'scheme'],
    ['not a url', 'host'],
  ])('refuses %s (%s)', (url, reason) => {
    expect(checkUrl(url)).toEqual({ ok: false, reason });
  });

  it('accepts ordinary addresses, with the default port written or not', () => {
    for (const url of [
      'https://good.example/a?b=c',
      'http://good.example:80/',
      'https://good.example.:443/',
    ]) {
      expect(checkUrl(url)).toMatchObject({ ok: true, host: 'good.example' });
    }
    expect(checkUrl('http://93.184.216.34/')).toMatchObject({ ok: true });
  });
});

describe('fetching', () => {
  it('fetches a public page and sends no cookies', async () => {
    const result = await safeFetchHtml('http://good.example/page', options());
    expect(result).toMatchObject({ ok: true, finalUrl: 'http://good.example/page' });
    expect(result.ok && result.html).toContain('<title>A page</title>');
    // The server saw the real host name, not the address it was reached at.
    expect(hits).toEqual(['good.example/page']);
  });

  it('never contacts the cloud metadata address, localhost or a private address (J9)', async () => {
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost:3000',
      'http://localhost/',
      'http://127.0.0.1/page',
      `http://127.0.0.1:${String(port)}/page`,
      'http://[::1]/page',
      'http://2130706433/page',
    ]) {
      expect(await safeFetchHtml(url, options())).toMatchObject({ ok: false, kind: 'blocked' });
    }
    expect(hits).toEqual([]);
  });

  it('refuses names that resolve to private addresses, in IPv4, IPv6 and mapped form', async () => {
    for (const host of ['internal', 'metadata', 'loopback6', 'mapped']) {
      expect(await safeFetchHtml(`http://${host}.example/page`, options())).toEqual({
        ok: false,
        kind: 'blocked',
        reason: 'private_address',
      });
    }
    // One private address among public ones is enough.
    expect(await safeFetchHtml('http://mixed.example/page', options())).toMatchObject({
      kind: 'blocked',
    });
    expect(hits).toEqual([]);
  });

  it('re-checks every redirect: a public page that redirects to a private address fetches nothing there (J9)', async () => {
    for (const path of [
      '/to-metadata',
      '/to-localhost',
      '/to-private-name',
      '/to-file',
      '/to-port',
    ]) {
      hits = [];
      const result = await safeFetchHtml(`http://good.example${path}`, options());
      expect(result).toMatchObject({ ok: false, kind: 'blocked' });
      // Only the public page itself was requested; the redirect target never was.
      expect(hits).toEqual([`good.example${path}`]);
    }
  });

  it('follows up to 3 redirects, re-resolving each host, and stops after that', async () => {
    const followed = options();
    const result = await safeFetchHtml('http://good.example/hop1', followed);
    expect(result).toMatchObject({ ok: true, finalUrl: 'http://good.example/page' });
    expect(followed.lookups).toEqual(['good.example', 'second.example', 'good.example']);
    expect(await safeFetchHtml('http://good.example/relative', options())).toMatchObject({
      ok: true,
    });

    hits = [];
    expect(await safeFetchHtml('http://good.example/loop0', options())).toEqual({
      ok: false,
      kind: 'error',
      reason: 'too_many_redirects',
    });
    expect(hits).toHaveLength(4);
  });

  it('connects to the address it checked, not to a second answer (DNS rebinding)', async () => {
    let call = 0;
    const dialled: string[] = [];
    const result = await safeFetchHtml('http://rebind.example/page', {
      lookup: () => {
        call += 1;
        // Public the first time, loopback every time after.
        return Promise.resolve([
          call === 1
            ? { address: PUBLIC_IP, family: 4 as const }
            : { address: '127.0.0.1', family: 4 as const },
        ]);
      },
      dial: (address) => {
        dialled.push(address);
        return { host: '127.0.0.1', port };
      },
    });
    expect(result.ok).toBe(true);
    // One lookup for the one hop, and the connection used exactly that answer.
    expect(call).toBe(1);
    expect(dialled).toEqual([PUBLIC_IP]);
  });

  it('gives up on pages that are not HTML, missing, compressed, unknown or unreachable', async () => {
    const reasonOf = async (url: string, extra: SafeFetchOptions = {}) => {
      const result = await safeFetchHtml(url, options(extra));
      return result.ok ? 'ok' : `${result.kind}:${result.reason}`;
    };
    expect(await reasonOf('http://good.example/json')).toBe('error:not_html');
    expect(await reasonOf('http://good.example/missing')).toBe('error:status');
    expect(await reasonOf('http://good.example/gzip')).toBe('error:encoded');
    expect(await reasonOf('http://nowhere.example/page')).toBe('error:dns');
    expect(
      await reasonOf('http://good.example/page', { dial: () => ({ host: '127.0.0.1', port: 1 }) }),
    ).toBe('error:network');
  });

  it('stops at the time limit, whether the server is slow to answer or to finish', async () => {
    for (const path of ['/never', '/slow']) {
      const started = Date.now();
      const result = await safeFetchHtml(`http://good.example${path}`, options({ timeoutMs: 300 }));
      expect(result).toEqual({ ok: false, kind: 'error', reason: 'timeout' });
      expect(Date.now() - started).toBeLessThan(2000);
    }
    const slowDns = await safeFetchHtml('http://good.example/page', {
      timeoutMs: 200,
      lookup: () => new Promise(() => undefined),
    });
    expect(slowDns).toEqual({ ok: false, kind: 'error', reason: 'timeout' });
  });

  it('reads at most the size limit of an endless page', async () => {
    const result = await safeFetchHtml('http://good.example/big', options({ maxBytes: 100_000 }));
    if (!result.ok) throw new Error(result.reason);
    expect(Buffer.byteLength(result.html)).toBe(100_000);
    expect(extractPreview(result.html, result.finalUrl)?.title).toBe('Big page');
  });

  it('reads the page in the character set it states', async () => {
    const result = await safeFetchHtml('http://good.example/latin1', options());
    expect(result.ok && extractPreview(result.html, result.finalUrl)?.title).toBe('Café');
  });

  it('local testing: a listed name is reached at its local address, and nothing else changes', async () => {
    const devHosts = new Map([['preview.test', { host: '127.0.0.1', port }]]);
    const result = await safeFetchHtml('http://preview.test/page', { devHosts });
    expect(result).toMatchObject({ ok: true });
    expect(hits).toEqual(['preview.test/page']);
    hits = [];
    // A redirect from a listed name to a private address is still refused.
    expect(await safeFetchHtml('http://preview.test/to-metadata', { devHosts })).toMatchObject({
      kind: 'blocked',
    });
    expect(await safeFetchHtml('http://127.0.0.1/page', { devHosts })).toMatchObject({
      kind: 'blocked',
    });
    expect(hits).toEqual(['preview.test/to-metadata']);
  });
});

describe('reading a page', () => {
  it("prefers the page's own summary tags and falls back to <title> and the host name", () => {
    const html = `<html><head>
      <TITLE>Plain title</TITLE>
      <meta property="og:title" content="Social &amp; title">
      <meta name="description" content="Plain description">
      <meta property='og:description' content='Social &quot;description&quot;'>
      <meta property=og:site_name content=Example>
    </head></html>`;
    expect(extractPreview(html, 'https://www.example.com/a')).toEqual({
      title: 'Social & title',
      description: 'Social "description"',
      siteName: 'Example',
    });
    expect(extractPreview('<title>Only a title</title>', 'https://www.example.com/a')).toEqual({
      title: 'Only a title',
      description: null,
      siteName: 'example.com',
    });
    expect(extractPreview('<p>No title here</p>', 'https://example.com/')).toBeNull();
    expect(extractPreview('<title>   </title>', 'https://example.com/')).toBeNull();
  });

  it('returns text only: tags stay text, control and direction-changing characters go, long text is cut', () => {
    const html = `<title>&lt;script&gt;alert(1)&lt;/script&gt; ${String.fromCharCode(0x202e)}evil\u0000 title\n\n second line</title>
      <meta name="description" content="${'word '.repeat(200)}">`;
    const preview = extractPreview(html, 'https://example.com/');
    expect(preview?.title).toBe('<script>alert(1)</script> evil title second line');
    expect(Array.from(preview?.description ?? '').length).toBeLessThanOrEqual(300);
    expect(preview?.description?.endsWith('…')).toBe(true);
  });

  it('decodes entities once and leaves unknown ones alone', () => {
    expect(decodeEntities('a &amp; b &#39;c&#x27; &#128512; &nope; &amp;lt; & &#0; &#xD800;')).toBe(
      "a & b 'c' \u{1F600} &nope; &lt; & &#0; &#xD800;",
    );
  });

  it('reads attributes in any quoting style', () => {
    expect(
      Object.fromEntries(parseAttributes(`<meta NAME="a b" content='c "d"' e=f g h="unclosed`)),
    ).toEqual({ name: 'a b', content: 'c "d"', e: 'f', g: '', h: 'unclosed' });
  });

  it('stays fast on pages built to be slow to read', () => {
    const started = Date.now();
    for (const html of [
      '<title'.repeat(80_000),
      '<meta '.repeat(80_000),
      `<meta ${'a'.repeat(500_000)}`,
      `<meta ${'a= '.repeat(150_000)}>`,
      `<title>${'&'.repeat(500_000)}</title>`,
      `${'<meta name="x" content="y">'.repeat(20_000)}<title>t</title>`,
    ]) {
      extractPreview(html, 'https://example.com/');
    }
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
