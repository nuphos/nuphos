import { FinishedThreadsBadge } from './nest-guides'

import type { RowDetailExtra } from './row-detail-extra'

/** A row's done count as a chip, or nothing when no sub-agent is done. */
export function finishedThreadsDetail(count: number): RowDetailExtra | null {
  if (count === 0) return null

  return { key: `done:${count}`, node: <FinishedThreadsBadge count={count} /> }
}
