import { is401 } from './k8s/errors.ts'

export type WatchStreamState = 'connecting' | 'live' | 'disconnected'

// A watch can stall without ever erroring — the socket stays open through a
// proxy that has stopped forwarding, and the informer waits forever. Nothing
// distinguishes that from a quiet cluster, so once a scope has gone this long
// without a single watch event we re-LIST to reconcile. Busy scopes never pay
// for this; idle ones pay one LIST per interval, which is the only way to tell
// "nothing happened" apart from "we stopped being told".
export const STALE_RESYNC_MS = 5 * 60_000
export const STALE_CHECK_MS = 60_000

/**
 * Where an informer 'error' belongs, given whether a (re)start currently owns
 * the failure path.
 *
 * `park` matters more than it looks: `ListWatch.start()` RESOLVES even when its
 * initial list call throws — the failure reaches the 'error' listener only. So a
 * parked error is the *only* evidence that the cache was never filled, and
 * dropping it lets a failed LIST be reported as a live, empty scope, i.e. "no
 * items" with no error on a cluster that is actually fine.
 */
export function routeWatchError(starting: boolean): 'park' | 'dispatch' {
  return starting ? 'park' : 'dispatch'
}

/** Whether a resolved `start()` actually filled the cache. */
export function watchStartSucceeded(parkedError: unknown): boolean {
  return !parkedError
}

export type WatchFailureVerdict = 'reconnect' | 'retry' | 'terminal'

/**
 * The informer never reaches `withAuthRetry`'s credential refresh: ListWatch
 * swallows the LIST rejection (it only reaches the 'error' listener) and its
 * internal watch re-connect is not wrapped at all. So a 401 gets its one
 * refresh per failure cycle here. A 401 that survives that refresh is terminal
 * until the user reconnects the cluster — retrying it forever only alternates
 * the renderer between connecting and disconnected while hammering the same
 * rejected credential.
 */
export async function resolveWatchFailure(
  error: unknown,
  cycle: { credentialRefreshAttempted: boolean },
  refreshCredentials: () => Promise<boolean>,
): Promise<WatchFailureVerdict> {
  if (!is401(error)) return 'reconnect'
  if (cycle.credentialRefreshAttempted) return 'terminal'
  cycle.credentialRefreshAttempted = true

  return (await refreshCredentials()) ? 'retry' : 'terminal'
}

// Wide enough that the once-a-minute check always lands before the shortest
// cloud-issued token (TKE/ACK, 14 minutes) expires.
export const CREDENTIAL_REFRESH_LEAD_MS = 3 * 60_000

/** Whether a credential with a known expiry should be refreshed ahead of it. */
export function credentialRefreshDue(expiresAt: number | null, now: number): boolean {
  return expiresAt !== null && expiresAt - now <= CREDENTIAL_REFRESH_LEAD_MS
}

export function shouldResyncStaleWatch(w: {
  hasSubscribers: boolean
  restarting: boolean
  state: WatchStreamState
  msSinceLastEvent: number
}): boolean {
  if (!w.hasSubscribers) return false
  if (w.restarting) return false
  // Anything not live belongs to the reconnect path, which backs off far
  // faster than this timer would.
  if (w.state !== 'live') return false

  return w.msSinceLastEvent >= STALE_RESYNC_MS
}
