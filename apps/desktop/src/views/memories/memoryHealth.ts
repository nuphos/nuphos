import type { AgentMemoryScorecard } from '../../api'

type Summary = AgentMemoryScorecard['summary']

// What a team member can read and act on. Pipeline telemetry — judge coverage,
// distillation and judge error counts — is deliberately absent: it lived here
// to feed a panel on an ungated page, where a failure count is alarm without
// recourse. Operators read those from the daily memory-health check instead.
export type MemoryHealth = {
  // Is memory actually helping? `applied` is null when nothing has been checked
  // yet — a rate has no meaning without a denominator. Each rate carries the
  // counts it came from, which is how the view communicates sample size.
  applied: { pct: number; applied: number; judged: number } | null
  /** Turns the attribution judge covered — the denominator behind `applied`. */
  checkedTurns: number
  windowDays: number
}

/** Derive the memory scorecard display model from the raw summary.
 *
 * The one rule that matters: applied% divides by CHECKED turns (`judge.ran`),
 * not all turns. A turn the judge never ran on cannot register "applied", so
 * including it in the denominator floors the rate. `turns.withApplied` is a
 * subset of checked turns by construction (only the judge sets appliedCount),
 * so the ratio is always ≤ 100%. */
export function deriveMemoryHealth(summary: Summary): MemoryHealth {
  const { turns, judge, windowDays } = summary
  const ran = judge.ran

  return {
    applied:
      ran > 0
        ? {
            pct: Math.round((turns.withApplied / ran) * 100),
            applied: turns.withApplied,
            judged: ran,
          }
        : null,
    checkedTurns: ran,
    windowDays,
  }
}
