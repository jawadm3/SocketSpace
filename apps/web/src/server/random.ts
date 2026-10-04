/**
 * What the random-chat pages need to know about a person before showing anything (RAND-02,
 * RAND-05, RAND-11): is the mode switched on, did they pass the 18+ gate for the current rules,
 * and is random chat paused for them.
 */
import 'server-only';

import { getRandomGate, getRandomPause, type Database } from '@socketspace/db';
import { isRandomGateAccepted } from '@socketspace/shared/random';

export interface RandomPageState {
  /** The gate was passed for the rules now in force. */
  accepted: boolean;
  /** An earlier version of the rules was accepted: the gate says they changed. */
  rulesChanged: boolean;
  /** The pause in force, if any, as the lobby shows it. */
  pause: { reason: string; until: string | null } | null;
}

export async function getRandomPageState(db: Database, userId: string): Promise<RandomPageState> {
  const [gate, pause] = await Promise.all([getRandomGate(db, userId), getRandomPause(db, userId)]);
  const accepted = isRandomGateAccepted(gate);
  return {
    accepted,
    rulesChanged: !accepted && gate?.termsVersion != null,
    pause: pause ? { reason: pause.reason, until: pause.until?.toISOString() ?? null } : null,
  };
}
