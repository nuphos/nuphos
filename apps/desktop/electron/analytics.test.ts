import assert from 'node:assert/strict'
import { before, mock, test } from 'node:test'

import type * as Analytics from './analytics.ts'

const calls: string[] = []
let analytics: typeof Analytics

before(async () => {
  delete process.env.VITE_DEV_SERVER_URL
  mock.module('posthog-node', {
    namedExports: {
      PostHog: class {
        constructor() {
          calls.push('construct')
        }
        enable() {
          calls.push('enable')

          return Promise.resolve()
        }
        disable() {
          calls.push('disable')

          return Promise.resolve()
        }
      },
    },
  })
  analytics = await import('./analytics.ts')
})

test('the setting never builds the client before the app is ready, and toggles it after', () => {
  // watchCrashes applies the saved setting before app ready.
  analytics.setMainAnalyticsEnabled(true)
  assert.deepEqual(calls, [])

  analytics.initMainAnalytics()
  assert.deepEqual(calls, ['construct'])

  analytics.setMainAnalyticsEnabled(false)
  analytics.setMainAnalyticsEnabled(true)
  assert.deepEqual(calls, ['construct', 'disable', 'enable'])
})
