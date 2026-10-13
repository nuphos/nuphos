import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { parseDesktop, parseElectronBackendHealth } from './dev-desktop.ts'
import { desktop } from './dev-services.ts'

describe('Electron backend health protocol', () => {
  test('parses a valid unhealthy event', () => {
    assert.deepEqual(
      parseElectronBackendHealth(
        JSON.stringify({
          event: 'nuphos.dev.electron_backend_health',
          status: 'unhealthy',
          consecutiveFailures: 3,
          latencyMs: 3001,
          error: 'fetch failed',
        }),
      ),
      {
        event: 'nuphos.dev.electron_backend_health',
        status: 'unhealthy',
        consecutiveFailures: 3,
        latencyMs: 3001,
        error: 'fetch failed',
      },
    )
  })

  test('ignores unrelated or malformed output', () => {
    assert.equal(parseElectronBackendHealth('[nuphos-dev] electron window opened'), null)
    assert.equal(
      parseElectronBackendHealth(
        JSON.stringify({
          event: 'nuphos.dev.electron_backend_health',
          status: 'unhealthy',
        }),
      ),
      null,
    )
  })

  test('marks a ready Desktop degraded on the first failed in-process probe', () => {
    desktop.status = 'ready'
    desktop.health = { electron: '✓', backend: '✓ 12ms' }

    parseDesktop(
      JSON.stringify({
        event: 'nuphos.dev.electron_backend_health',
        status: 'unhealthy',
        consecutiveFailures: 1,
        latencyMs: 3000,
        error: 'fetch failed',
      }),
    )

    assert.equal(desktop.status, 'degraded')
    assert.equal(desktop.health.backend, '✕ 1×')

    parseDesktop(
      JSON.stringify({
        event: 'nuphos.dev.electron_backend_health',
        status: 'healthy',
        consecutiveFailures: 0,
        latencyMs: 9,
      }),
    )

    assert.equal(desktop.status, 'ready')
    assert.equal(desktop.health.backend, '✓ 9ms')
  })
})
