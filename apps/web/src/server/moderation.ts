/**
 * Sanctions from the web app (ADMIN-03): the database decides and records
 * (packages/db `applySanction`, `liftSanction`), then the realtime server is told, so the person
 * reads the reason at once and, for a suspension or ban, every open connection closes
 * (realtime-protocol.md, "Moderation flow").
 *
 * The moderation dashboard (Stage E3) calls these; nothing else may.
 */
import 'server-only';

import {
  applySanction,
  getActiveSanctions,
  liftSanction,
  type ApplySanctionInput,
  type ApplySanctionResult,
  type Database,
  type LiftSanctionInput,
  type LiftSanctionResult,
} from '@socketspace/db';

import type { RealtimeNotifier } from './realtime-events';

export interface ModerationDeps {
  db: Database;
  notifier: RealtimeNotifier;
}

export async function sanctionUser(
  deps: ModerationDeps,
  input: ApplySanctionInput,
): Promise<ApplySanctionResult> {
  const result = await applySanction(deps.db, input);
  if (result.ok) {
    const { sanction } = result;
    await deps.notifier.notify({
      type: 'user.sanctioned',
      userId: sanction.userId,
      kind: sanction.kind,
      reason: sanction.reason,
      until: sanction.expiresAt?.toISOString() ?? null,
    });
  }
  return result;
}

export async function liftUserSanction(
  deps: ModerationDeps,
  input: LiftSanctionInput,
): Promise<LiftSanctionResult> {
  const result = await liftSanction(deps.db, input);
  if (result.ok) {
    await deps.notifier.notify({
      type: 'user.unsanctioned',
      userId: input.targetUserId,
      kind: input.kind,
    });
  }
  return result;
}

export interface AccountMute {
  /** ISO time the mute ends. */
  until: string;
  reason: string;
}

/** The site-wide mute in force for this person, if any (the one that ends last). */
export async function getAccountMute(db: Database, userId: string): Promise<AccountMute | null> {
  const mutes = (await getActiveSanctions(db, userId)).filter(
    (s) => s.kind === 'mute' && s.expiresAt !== null,
  );
  const last = mutes.reduce<(typeof mutes)[number] | null>(
    (latest, s) =>
      !latest || (s.expiresAt?.getTime() ?? 0) > (latest.expiresAt?.getTime() ?? 0) ? s : latest,
    null,
  );
  return last?.expiresAt ? { until: last.expiresAt.toISOString(), reason: last.reason } : null;
}
