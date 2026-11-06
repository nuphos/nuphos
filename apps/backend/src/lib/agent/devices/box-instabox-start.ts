import { startWithinLimit } from './box-instabox-limit'

import type { BoxAccountRef } from './box-instabox-account'

/** Starts a machine; only the deployment's account counts against the team's vCPU limit. */
export function startBox<T>(
  box: BoxAccountRef,
  starting: { vcpus: number } | { sandboxId: string },
  start: () => Promise<T>,
): Promise<T> {
  return box.accountId ? start() : startWithinLimit(box.teamId, starting, start)
}
