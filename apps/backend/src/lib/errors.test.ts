import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { AppError, errorHandler, notFoundHandler } from '@/lib/errors'

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

function appThrowing(err: unknown): Hono {
  const app = new Hono()

  app.onError(errorHandler)
  app.get('/', () => {
    throw err
  })

  return app
}

describe('errorHandler', () => {
  // Cloudflare swaps an origin 502/504 for its own page and drops this body.
  test('answers our own upstream 502 with 503 and keeps our JSON body', async () => {
    const res = await appThrowing(
      new AppError(502, 'tailscale_api_error', 'token revoked'),
    ).request('/')

    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: { code: string; message: string } }

    expect(body.error).toMatchObject({ code: 'tailscale_api_error', message: 'token revoked' })
  })

  test('answers a cloud SDK 4xx with 503 cloud_api_error and the upstream status', async () => {
    const err = Object.assign(new Error('PERMISSION_DENIED: unable to impersonate'), {
      response: { status: 403 },
    })
    const res = await appThrowing(err).request('/')

    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: { code: string; upstreamStatus: number } }

    expect(body.error).toMatchObject({ code: 'cloud_api_error', upstreamStatus: 403 })
  })

  test('leaves other statuses unchanged', async () => {
    const res = await appThrowing(new AppError(409, 'conflict', 'taken')).request('/')

    expect(res.status).toBe(409)
  })
})
