import { expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useModels } from '@/lib/test/doubles/models'

// Cloudflare's rejection (e.g. an unregistered scope) must reach the desktop's
// poll, not only the nuphos:// deep link another app instance may capture.
const TEAM = new ObjectId()
const results = new Map<string, Record<string, unknown>>()

useModels({
  cloudflarePendingOAuth: () =>
    ({
      findOne: ({ _id }: { _id: string }) =>
        Promise.resolve(_id === 's1' ? { _id, teamId: TEAM } : null),
    }) as never,
  cloudflareOAuthResult: () =>
    ({
      replaceOne: ({ _id }: { _id: string }, doc: Record<string, unknown>) => {
        results.set(_id, doc)

        return Promise.resolve({ acknowledged: true })
      },
      findOneAndDelete: ({ _id }: { _id: string }) => {
        const doc = results.get(_id)

        results.delete(_id)

        return Promise.resolve(doc ? { _id, ...doc } : null)
      },
    }) as never,
})

const { cloudflareAppRoutes } = await import('./cloudflare-app')

test('an authorize error is served to the polling desktop with its reason', async () => {
  const description = "The OAuth 2.0 Client is not allowed to request scope 'dns-firewall.read'."
  const query = new URLSearchParams({ state: 's1', error: 'invalid_scope', error_description: description })

  await cloudflareAppRoutes.request(`/setup?${query.toString()}`)
  const res = await cloudflareAppRoutes.request('/result/s1')

  // Still ready: false, so desktops without the error field keep waiting
  // instead of treating it as a bind.
  expect(await res.json()).toEqual({
    ready: false,
    error: 'invalid_scope',
    errorDescription: description,
  })
})

test('an error for a state with no pending attempt records nothing', async () => {
  await cloudflareAppRoutes.request('/setup?state=unknown&error=access_denied')

  expect(results.size).toBe(0)
})
