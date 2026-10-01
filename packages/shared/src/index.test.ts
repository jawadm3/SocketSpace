import { describe, expect, it } from 'vitest';

import { APP_NAME } from './index';

// Toolchain smoke test: proves the workspace, TypeScript and Vitest are wired up.
describe('@socketspace/shared', () => {
  it('exports the product name', () => {
    expect(APP_NAME).toBe('SocketSpace');
  });
});
