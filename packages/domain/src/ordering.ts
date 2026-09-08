const STEP = 1024;

/**
 * Midpoint ordering. Doubles allow ~50 bisections between two neighbours before
 * precision runs out, which is plenty for hand-ordered lists.
 */
export function sortOrderBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined) return after === undefined ? 0 : after - STEP;
  if (after === undefined) return before + STEP;
  return before + (after - before) / 2;
}
