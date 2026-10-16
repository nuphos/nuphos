import { createHmac, randomBytes } from 'node:crypto'

import { afterAll, beforeAll, expect, test } from 'bun:test'

import { config } from '@/config'
import { useLinearIssueWebhook } from '@/lib/test/doubles/linear-issue-webhook'

let applied = 0

useLinearIssueWebhook({
  applyLinearIssueWebhook: () => {
    applied++

    return Promise.resolve()
  },
})

const { linearAppRoutes } = await import('./linear-app')
const SECRET = randomBytes(16).toString('hex')
const original = config.byos.linear.webhookSecret

beforeAll(() => {
  config.byos.linear.webhookSecret = SECRET
})
afterAll(() => {
  config.byos.linear.webhookSecret = original
})

function deliver(webhookTimestamp: number) {
  const body = JSON.stringify({ type: 'Issue', action: 'update', webhookTimestamp })
  const signature = createHmac('sha256', SECRET).update(body).digest('hex')

  return linearAppRoutes.request('/webhook', {
    method: 'POST',
    headers: { 'Linear-Signature': signature, 'Content-Type': 'application/json' },
    body,
  })
}

test('accepts a fresh signed delivery', async () => {
  expect((await deliver(Date.now())).status).toBe(200)
  expect(applied).toBe(1)
})

test('refuses a signed delivery replayed after a minute', async () => {
  applied = 0
  const response = await deliver(Date.now() - 2 * 60_000)

  expect(response.status).not.toBe(200)
  expect(applied).toBe(0)
})
