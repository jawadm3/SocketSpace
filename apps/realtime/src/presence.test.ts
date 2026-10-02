/**
 * Presence rules across tabs and invisible mode (RT-03, PROF-02).
 */
import { describe, expect, it } from 'vitest';

import { PresenceTracker } from './presence';

describe('PresenceTracker', () => {
  it('combines tabs: dnd wins, then online, then away; offline when the last tab closes', () => {
    const p = new PresenceTracker();
    expect(p.connect('ava', 'tab1', true)).toEqual({ userId: 'ava', status: 'online' });
    expect(p.connect('ava', 'tab2', true)).toBeNull(); // still online
    expect(p.set('ava', 'tab1', 'away')).toBeNull(); // tab2 is still in use
    expect(p.set('ava', 'tab2', 'away')).toEqual({ userId: 'ava', status: 'away' });
    expect(p.set('ava', 'tab1', 'dnd')).toEqual({ userId: 'ava', status: 'dnd' });
    expect(p.disconnect('ava', 'tab1')).toEqual({ userId: 'ava', status: 'away' });
    expect(p.disconnect('ava', 'tab2')).toEqual({ userId: 'ava', status: 'offline' });
    expect(p.isConnected('ava')).toBe(false);
  });

  it('shows invisible people as offline, and reveals them when they switch it off', () => {
    const p = new PresenceTracker();
    expect(p.connect('sam', 'tab1', false)).toBeNull();
    expect(p.visibleStatus('sam')).toBe('offline');
    expect(p.set('sam', 'tab1', 'dnd')).toBeNull();
    expect(p.setVisible('sam', true)).toEqual({ userId: 'sam', status: 'dnd' });
    expect(p.setVisible('sam', false)).toEqual({ userId: 'sam', status: 'offline' });
  });

  it('ignores reports from tabs it does not know', () => {
    const p = new PresenceTracker();
    expect(p.set('lee', 'ghost', 'online')).toBeNull();
    expect(p.setVisible('lee', true)).toBeNull();
  });
});
