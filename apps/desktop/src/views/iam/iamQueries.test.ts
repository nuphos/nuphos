import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import { QueryObserver } from '@tanstack/react-query'

const answers = new Map<string, PromiseWithResolvers<{ accountId: string }>>()

mock.module('../../api.ts', {
  namedExports: {
    api: {
      atlasGetCloudflareIamPermissions: (_team: string, accountId: string) => {
        const answer = Promise.withResolvers<{ accountId: string }>()

        answers.set(accountId, answer)

        return answer.promise
      },
    },
  },
})

const { createQueryClient } = await import('../../lib/query/client.ts')
const { cloudflarePermissionsQuery } = await import('./iamQueries.ts')

test("switching Cloudflare accounts never shows the previous account's details", async () => {
  const client = createQueryClient()
  const shown = new QueryObserver(client, cloudflarePermissionsQuery('t', 'a'))
  const stop = shown.subscribe(() => {})

  answers.get('a')?.resolve({ accountId: 'a' })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(shown.getCurrentResult().data?.accountId, 'a')

  shown.setOptions(cloudflarePermissionsQuery('t', 'b'))
  assert.equal(shown.getCurrentResult().data, undefined, 'nothing until b answers')
  answers.get('b')?.resolve({ accountId: 'b' })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(shown.getCurrentResult().data?.accountId, 'b')
  stop()
  client.clear()
})
