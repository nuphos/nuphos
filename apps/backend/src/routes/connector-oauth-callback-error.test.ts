import { describe, expect, test } from 'bun:test'

import { useModels } from '@/lib/test/doubles/models'

import type { Hono } from 'hono'

/**
 * An `error=` callback only knows the state from the URL, which anyone the
 * authorize link reached can replay. It reports the error and leaves the
 * pending request alone: it expires on its own, and the requester can cancel
 * it from their session.
 */
const touched: string[] = []

function pending(name: string) {
  const record = (method: string) => () => {
    touched.push(`${name}.${method}`)

    return Promise.resolve(null)
  }

  return () =>
    ({
      deleteOne: record('deleteOne'),
      deleteMany: record('deleteMany'),
      findOneAndDelete: record('findOneAndDelete'),
      updateOne: record('updateOne'),
    }) as never
}

useModels({
  asanaPendingOAuth: pending('asana'),
  cloudflarePendingOAuth: pending('cloudflare'),
  gitlabPendingOAuth: pending('gitlab'),
  jiraPendingOAuth: pending('jira'),
  linearPendingOAuth: pending('linear'),
  plaudPendingOAuth: pending('plaud'),
  posthogPendingOAuth: pending('posthog'),
  sentryPendingOAuth: pending('sentry'),
  slackPendingOAuth: pending('slack'),
})

const callbacks: [string, () => Promise<Hono>, string][] = [
  ['asana', async () => (await import('./asana-app')).asanaAppRoutes, '/setup'],
  ['cloudflare', async () => (await import('./cloudflare-app')).cloudflareAppRoutes, '/setup'],
  ['gitlab', async () => (await import('./gitlab-app')).gitlabAppRoutes, '/setup'],
  ['jira', async () => (await import('./jira-app')).jiraAppRoutes, '/setup'],
  ['linear', async () => (await import('./linear-app')).linearAppRoutes, '/setup'],
  ['plaud', async () => (await import('./plaud-app')).plaudAppRoutes, '/callback'],
  ['posthog', async () => (await import('./posthog-app')).posthogAppRoutes, '/callback'],
  ['sentry', async () => (await import('./sentry-app')).sentryAppRoutes, '/setup'],
  ['slack', async () => (await import('./slack-app')).slackAppRoutes, '/setup'],
]

describe('connector OAuth callbacks with error=', () => {
  test.each(callbacks)('%s leaves the pending request in place', async (_name, routes, path) => {
    touched.length = 0
    const app = await routes()
    const res = await app.request(`${path}?state=someone-elses-state&error=access_denied`)

    expect(res.status).toBeLessThan(500)
    expect(touched).toEqual([])
  })
})
