import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'
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
const othersRevoked: [string, string][] = []

useIdentity({
  authenticateToken: (async (token: string) => {
    // A 30-day sign-in JWT from before sessions: a user, but no session.
    if (token === 'old-sign-in') return { user: USER, cacheHit: false, provider: 'nuphos' }
    if (token === 'session')
      return { user: USER, cacheHit: false, provider: 'nuphos', sessionId: CURRENT }
    if (token === 'run') return { user: USER, cacheHit: false, provider: 'nuphos' }

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
  revokeOtherUserSessions: async (userId: string, keepId: string) => {
    othersRevoked.push([userId, keepId])

    return 2
  },
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
  othersRevoked.length = 0
})

test('signing out the other devices keeps this one', async () => {
  const res = await call('DELETE', '/auth/sessions', 'session')

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ revoked: 2 })
  expect(othersRevoked).toEqual([[USER.id, CURRENT]])
})

test('a sign-in from before sessions is asked to sign in again', async () => {
  const res = await call('GET', '/auth/sessions', 'old-sign-in')

  expect(res.status).toBe(403)
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe('session_required')
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
