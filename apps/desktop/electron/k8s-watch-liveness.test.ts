import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  CREDENTIAL_REFRESH_LEAD_MS,
  STALE_RESYNC_MS,
  credentialRefreshDue,
  resolveWatchFailure,
  routeWatchError,
  shouldResyncStaleWatch,
  watchStartSucceeded,
} from './k8s-watch-liveness.ts'

const live = {
  hasSubscribers: true,
  restarting: false,
  state: 'live' as const,
  msSinceLastEvent: STALE_RESYNC_MS + 1,
}

describe('stale watch resync', () => {
  it('re-LISTs a live watch that has gone quiet past the threshold', () => {
    assert.equal(shouldResyncStaleWatch(live), true)
  })

  it('leaves a watch alone while events are still arriving', () => {
    assert.equal(shouldResyncStaleWatch({ ...live, msSinceLastEvent: STALE_RESYNC_MS - 1 }), false)
  })

  it('does not resync a scope nobody is looking at', () => {
    assert.equal(shouldResyncStaleWatch({ ...live, hasSubscribers: false }), false)
  })

  it('does not race a restart that is already in flight', () => {
    assert.equal(shouldResyncStaleWatch({ ...live, restarting: true }), false)
  })

  it('leaves a disconnected watch to the reconnect backoff', () => {
    assert.equal(shouldResyncStaleWatch({ ...live, state: 'disconnected' }), false)
    assert.equal(shouldResyncStaleWatch({ ...live, state: 'connecting' }), false)
  })
})

describe('a failed initial LIST is not success', () => {
  // ListWatch.start() resolves even when its list call throws, so the parked
  // error is the only signal that the cache was never filled. Losing it renders
  // as "no items" with no error on a perfectly healthy cluster.
  it('parks an error raised while the start owns the failure path', () => {
    assert.equal(routeWatchError(true), 'park')
  })

  it('dispatches errors that arrive once the start has settled', () => {
    assert.equal(routeWatchError(false), 'dispatch')
  })

  it('treats a parked error as a failed start', () => {
    assert.equal(watchStartSucceeded('Kubernetes API did not respond'), false)
  })

  it('treats a clean start as success', () => {
    assert.equal(watchStartSucceeded(undefined), true)
  })
})

const unauthorized = () => new Error('HTTP-Code: 401 Message: Unauthorized')

function refresher(result: boolean) {
  let calls = 0
  const refresh = async () => {
    calls += 1

    return result
  }

  return { refresh, calls: () => calls }
}

describe('watch failure recovery', () => {
  it('keeps reconnecting transient watch failures without touching credentials', async () => {
    const r = refresher(true)
    const cycle = { credentialRefreshAttempted: false }

    assert.equal(
      await resolveWatchFailure(new Error('socket disconnected'), cycle, r.refresh),
      'reconnect',
    )
    assert.equal(r.calls(), 0)
    assert.equal(cycle.credentialRefreshAttempted, false)
  })

  it('refreshes the credential once on a 401 and retries the start', async () => {
    const r = refresher(true)
    const cycle = { credentialRefreshAttempted: false }

    assert.equal(await resolveWatchFailure(unauthorized(), cycle, r.refresh), 'retry')
    assert.equal(r.calls(), 1)
    assert.equal(cycle.credentialRefreshAttempted, true)
  })

  it('parks a 401 that survives the refresh instead of refreshing forever', async () => {
    const r = refresher(true)
    const cycle = { credentialRefreshAttempted: false }

    await resolveWatchFailure(unauthorized(), cycle, r.refresh)
    assert.equal(await resolveWatchFailure(unauthorized(), cycle, r.refresh), 'terminal')
    assert.equal(r.calls(), 1)
  })

  it('parks a 401 when the credential cannot be refreshed', async () => {
    const r = refresher(false)
    const cycle = { credentialRefreshAttempted: false }

    assert.equal(await resolveWatchFailure(unauthorized(), cycle, r.refresh), 'terminal')
    assert.equal(r.calls(), 1)
  })

  it('spends a fresh refresh once a successful start opened a new cycle', async () => {
    const r = refresher(true)
    const cycle = { credentialRefreshAttempted: false }

    await resolveWatchFailure(unauthorized(), cycle, r.refresh)
    cycle.credentialRefreshAttempted = false
    assert.equal(await resolveWatchFailure(unauthorized(), cycle, r.refresh), 'retry')
    assert.equal(r.calls(), 2)
  })
})

describe('proactive credential refresh', () => {
  const now = 1_000_000_000

  it('refreshes ahead of a known expiry', () => {
    assert.equal(credentialRefreshDue(now + CREDENTIAL_REFRESH_LEAD_MS, now), true)
    assert.equal(credentialRefreshDue(now - 1, now), true)
  })

  it('leaves a credential alone while it still has headroom', () => {
    assert.equal(credentialRefreshDue(now + CREDENTIAL_REFRESH_LEAD_MS + 1, now), false)
  })

  it('never refreshes a credential with no known expiry', () => {
    assert.equal(credentialRefreshDue(null, now), false)
  })
})
