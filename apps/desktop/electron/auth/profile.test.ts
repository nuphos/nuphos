import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'

import { isRouteMissing, routeMissing } from './profile.ts'

test('a server without the route is told apart from a route answering 404', () => {
  assert.equal(
    isRouteMissing(404, { error: { code: 'route_not_found', message: 'Route GET /x not found' } }),
    true,
  )
  assert.equal(isRouteMissing(404, undefined), true)
  assert.equal(isRouteMissing(405, { error: { code: 'method_not_allowed' } }), true)
  assert.equal(isRouteMissing(404, { error: { code: 'user_not_found' } }), false)
  assert.equal(isRouteMissing(500, undefined), false)
  assert.equal(isRouteMissing(400, { error: { code: 'invalid_character' } }), false)
})

test("over HTTP, the live server's 404 for an unknown route reads as missing, a real 404 does not", async () => {
  // The exact body production sends for a route it does not have (lib/errors.ts notFoundHandler).
  const server = createServer((req, res) => {
    const missing = req.url?.startsWith('/auth/me/level') ?? false

    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify(
        missing
          ? { error: { code: 'route_not_found', message: 'Route GET /auth/me/level not found' } }
          : { error: { code: 'user_not_found', message: 'Your account no longer exists' } },
      ),
    )
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }

  try {
    const level = await fetch(`http://127.0.0.1:${String(port)}/auth/me/level?timeZone=UTC`)

    assert.equal(await routeMissing(level), true)
    // The body is still readable after the check.
    assert.equal(
      ((await level.json()) as { error: { code: string } }).error.code,
      'route_not_found',
    )
    assert.equal(
      await routeMissing(await fetch(`http://127.0.0.1:${String(port)}/auth/me/character`)),
      false,
    )
  } finally {
    server.close()
  }
})
