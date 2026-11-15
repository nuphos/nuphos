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

test('a client that is off at launch is never built, so nothing can be sent', async () => {
  const fresh = (await import('./analytics.ts?off')) as typeof Analytics
  const before = calls.length

  // What crash-reporter.ts passes for a self-hosted backend, or with the setting off.
  fresh.setMainAnalyticsEnabled(false)
  fresh.initMainAnalytics()
  fresh.setAnalyticsUser('user-1', { email: 'someone@example.com' })
  fresh.captureMain('app_launched')
  fresh.captureMainException(new Error('boom'))
  assert.equal(calls.length, before)
})
