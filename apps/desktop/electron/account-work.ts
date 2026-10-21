// Counts the times the app left an account, so work started for one account
// (a terminal still fetching its credentials or probing its target) can tell,
// once its awaits are over, that the account has gone, instead of opening a
// connection nobody owns any more.

import { accountContext } from './api-endpoint.ts'

let epoch = 0

/** Taken before work for the signed-in account starts. */
export function accountEpoch(): number {
  return epoch
}

/** The app is leaving the signed-in account: work started for it is now stale. */
export function endAccountWork(): void {
  epoch += 1
}

/** Refuses to go on with work started for an account the app has since left. */
export function assertSameAccount(since: number): void {
  if (since !== epoch) throw new Error('The account changed. Open it again.')
}

accountContext.onLeave(endAccountWork)
