import { expect, test } from 'bun:test'

import { bindSchema } from './shared'

test("Better Stack's bind body takes the member's share choice", () => {
  const body = { label: 'Status', uptimeApiToken: 'token', share: { mode: 'team' } }

  expect(bindSchema.safeParse(body).success).toBe(true)
  expect(bindSchema.safeParse({ ...body, share: { mode: 'everyone' } }).success).toBe(false)
})
