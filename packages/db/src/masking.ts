import { maskText, scanText } from '@socketspace/shared/moderation';

/**
 * A message's text as readers see it: medium-severity words (SAFE-02) are masked here, on the way
 * out, so the stored text stays as written for the moderators who review the flag.
 */
export function visibleBody(row: { body: string; filterSeverity: number }): string {
  if (row.filterSeverity < 2) return row.body;
  return maskText(row.body, scanText(row.body).matches, 2);
}
