import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { notFoundHandler } from '@/lib/errors'

describe('notFoundHandler', () => {
  test('labels router 404s route_not_found, separate from missing-record not_found', async () => {
    const app = new Hono()

    app.notFound(notFoundHandler)

    const res = await app.request('/teams/abc/database-connections')

    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string; message: string } }

    expect(body.error.code).toBe('route_not_found')
    // decideErrorToast (apps/desktop/src/api.ts) also matches this message shape
    // to suppress router 404s from backends released before the code existed.
    expect(body.error.message).toMatch(/^Route [A-Z]+ \S* not found$/)
  })
})
