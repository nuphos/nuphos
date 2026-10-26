import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'
import { requireAuth } from '@/middleware/auth'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useIdentitySessions } from '@/lib/test/doubles/identity-sessions'

import type * as identityActual from '@/lib/identity'

const USER = {
  id: '507f1f77bcf86cd799439011',
  email: 'dev@example.com',
  name: 'Dev',
  username: 'dev',
}
const CURRENT = '64b7f0c2a1b2c3d4e5f60001'
const revoked: [string, string][] = []

useIdentity({
  authenticateToken: (async (token: string) => {
    if (token === 'session')
      return { user: USER, cacheHit: false, provider: 'nuphos', sessionId: CURRENT }
    if (token === 'run') return { user: USER, cacheHit: false, provider: 'nuphos', agentRun: true }
    if (token === 'legacy') return { user: USER, cacheHit: false, provider: 'nuphos' }

    return null
  }) as unknown as typeof identityActual.authenticateToken,
})
useIdentitySessions({
  listUserSessions: async (userId: string, currentId?: string) => [
    {
      id: CURRENT,
      current: currentId === CURRENT,
      createdAt: '',
      lastUsedAt: '',
      expiresAt: '',
      ip: null,
      userAgent: userId,
    },
  ],
  revokeUserSession: async (userId: string, id: string) => {
    revoked.push([userId, id])

    return id === CURRENT
  },
})

const { auth } = await import('@/routes/auth')
const app = new Hono().onError(errorHandler).route('/auth', auth)
const call = (method: string, path: string, token: string) =>
  app.request(path, { method, headers: { Authorization: `Bearer ${token}` } })

beforeEach(() => {
  revoked.length = 0
})

test('a session lists the account sessions and sees which one it is', async () => {
  const res = await call('GET', '/auth/sessions', 'session')

  expect(res.status).toBe(200)
  expect(((await res.json()) as { sessions: { current: boolean }[] }).sessions[0]!.current).toBe(
    true,
  )
})

test('`current` signs this client out', async () => {
  expect((await call('DELETE', '/auth/sessions/current', 'session')).status).toBe(204)
  expect(revoked).toEqual([[USER.id, CURRENT]])
})

test('an unknown session is a 404', async () => {
  expect((await call('DELETE', '/auth/sessions/64b7f0c2a1b2c3d4e5f60002', 'session')).status).toBe(
    404,
  )
})

test('an agent-run token cannot see or end sign-in sessions', async () => {
  expect((await call('GET', '/auth/sessions', 'run')).status).toBe(403)
  expect((await call('DELETE', '/auth/sessions/current', 'run')).status).toBe(403)
  expect(revoked).toEqual([])
})

test('an agent run cannot mint lasting credentials; a sign-in can', async () => {
  const minting = new Hono().onError(errorHandler).use('*', requireAuth)

  for (const path of ['/auth/cli-tokens', '/auth/device/approve', '/agent/devices/join-tokens'])
    minting.post(path, (c) => c.json({ minted: true }))
  const post = (path: string, token: string) =>
    minting.request(path, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })

  for (const path of ['/auth/cli-tokens', '/auth/device/approve', '/agent/devices/join-tokens']) {
    expect((await post(path, 'run')).status).toBe(403)
    expect((await post(path, 'session')).status).toBe(200)
    // Sign-ins from before sessions still work until they expire.
    expect((await post(path, 'legacy')).status).toBe(200)
  }
})
