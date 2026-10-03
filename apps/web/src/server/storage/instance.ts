/** The storage driver chosen by the environment (`STORAGE_DRIVER`), created on first use. */
import 'server-only';

import { del, get, put } from '@vercel/blob';

import { getWebEnv } from '../env';
import {
  createLocalStorage,
  createMemoryStorage,
  createVercelBlobStorage,
  defaultLocalStorageDir,
  type StorageDriver,
} from './index';

let storage: StorageDriver | undefined;

export function getStorage(): StorageDriver {
  if (storage) return storage;
  const env = getWebEnv();
  if (env.STORAGE_DRIVER === 'vercel-blob') {
    // checkWebEnv has made sure the token is set.
    storage = createVercelBlobStorage(env.BLOB_READ_WRITE_TOKEN ?? '', { put, get, del });
  } else if (env.STORAGE_DRIVER === 'memory') {
    storage = createMemoryStorage();
  } else {
    storage = createLocalStorage(env.STORAGE_LOCAL_DIR ?? defaultLocalStorageDir());
  }
  return storage;
}
