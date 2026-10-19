import { expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'

import { requireAdmin } from './auth'

const app = new Hono()
  .use('*', requireAdmin)
  .all('*', (c) => c.text('ok'))
  .onError(errorHandler)

test('refuses a cross-site state change before reading the cookie', async () => {
  const response = await app.request('/skills/object', {
    method: 'POST',
    headers: { 'Sec-Fetch-Site': 'cross-site' },
  })

  expect(response.status).toBe(403)
})

test('lets cross-site reads reach the normal cookie check', async () => {
  const response = await app.request('/skills', { headers: { 'Sec-Fetch-Site': 'cross-site' } })

  expect(response.status).toBe(401)
})
