/**
 * Where stored pictures live (D-013). The rest of the app only knows this small interface, so the
 * storage service can be changed with one setting (`STORAGE_DRIVER`):
 *
 * - `vercel-blob`: Vercel Blob, private access (production; free tier). Files can only be read
 *   with our token, so every picture a browser sees has passed through `/api/media/<id>` and its
 *   permission check.
 * - `local`: a folder on this computer (development and end-to-end tests).
 * - `memory`: nothing is written anywhere (automated tests).
 *
 * Keys are made here, from random bytes, never from anything a person typed. Each driver refuses
 * any key that does not have exactly that shape, so a key can never point outside its folder.
 */
import 'server-only';

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

import type { UploadKind } from '@socketspace/shared/media';

export interface StorageDriver {
  readonly name: string;
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  /** The stored bytes, or `null` when nothing is stored under this key. */
  get(key: string): Promise<Buffer | null>;
  /** Deleting something that is not there is not an error. */
  delete(keys: readonly string[]): Promise<void>;
}

const KEY_PATTERN = /^[am]\/[0-9a-f]{32}\.webp$/;

/** A new random key: `m/<32 hex>.webp` for message pictures, `a/...` for avatars. */
export function newStorageKey(kind: UploadKind): string {
  return `${kind === 'avatar' ? 'a' : 'm'}/${randomBytes(16).toString('hex')}.webp`;
}

export function isStorageKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

function assertKey(key: string): void {
  if (!isStorageKey(key)) throw new Error('Invalid storage key');
}

export function createMemoryStorage(): StorageDriver & { size(): number } {
  const files = new Map<string, Buffer>();
  /** Like the other drivers, a bad key is a rejected promise, not a thrown error. */
  const checked = <T>(keys: readonly string[], run: () => T): Promise<T> =>
    keys.every(isStorageKey)
      ? Promise.resolve(run())
      : Promise.reject(new Error('Invalid storage key'));
  return {
    name: 'memory',
    put: (key, bytes) =>
      checked([key], () => {
        files.set(key, Buffer.from(bytes));
      }),
    get: (key) => checked([key], () => files.get(key) ?? null),
    delete: (keys) =>
      checked(keys, () => {
        for (const key of keys) files.delete(key);
      }),
    size: () => files.size,
  };
}

export function createLocalStorage(directory: string): StorageDriver {
  const root = resolve(directory);
  const pathOf = (key: string): string => {
    assertKey(key);
    const path = resolve(root, key);
    // Belt and braces: the key shape already rules this out.
    if (!path.startsWith(root + sep)) throw new Error('Invalid storage key');
    return path;
  };
  return {
    name: 'local',
    async put(key, bytes) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      // 'wx': never overwrite. Keys are random, so an existing file means something is wrong.
      await writeFile(path, bytes, { flag: 'wx' });
    },
    async get(key) {
      try {
        return await readFile(pathOf(key));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async delete(keys) {
      for (const key of keys) await rm(pathOf(key), { force: true });
    },
  };
}

/** The small part of `@vercel/blob` this driver uses (so tests can stand in for the service). */
export interface BlobApi {
  put(
    pathname: string,
    body: Buffer,
    options: {
      access: 'private';
      token: string;
      contentType: string;
      addRandomSuffix: false;
      allowOverwrite: false;
    },
  ): Promise<unknown>;
  get(
    pathname: string,
    options: { access: 'private'; token: string },
  ): Promise<{ statusCode: number; stream: ReadableStream<Uint8Array> | null } | null>;
  del(pathnames: string[], options: { token: string }): Promise<void>;
}

export function createVercelBlobStorage(token: string, api: BlobApi): StorageDriver {
  return {
    name: 'vercel-blob',
    async put(key, bytes, contentType) {
      assertKey(key);
      await api.put(key, bytes, {
        access: 'private',
        token,
        contentType,
        addRandomSuffix: false,
        allowOverwrite: false,
      });
    },
    async get(key) {
      assertKey(key);
      const found = await api.get(key, { access: 'private', token });
      if (found?.statusCode !== 200 || !found.stream) return null;
      return Buffer.from(await new Response(found.stream).arrayBuffer());
    },
    async delete(keys) {
      for (const key of keys) assertKey(key);
      if (keys.length > 0) await api.del([...keys], { token });
    },
  };
}

/** The default local folder: <repo>/.cache/uploads (on the D: drive, git-ignored). */
export function defaultLocalStorageDir(): string {
  return resolve(process.cwd(), '..', '..', '.cache', 'uploads');
}
