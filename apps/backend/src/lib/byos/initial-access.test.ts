import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'

import { initialBindingAccess, newBindingAccess } from './initial-access'

import type { NuphosTeam } from '@/lib/identity/types'
import type { TeamAuthVariables } from '@/middleware/auth/types'

const shared = { bindingShareDefault: 'team' } as const
const closed = { bindingShareDefault: 'private' } as const

describe('initialBindingAccess', () => {
  test('a new binding is private to the member who connected it', () => {
    expect(initialBindingAccess({ userId: 'u1', team: closed })).toMatchObject({
      memberAllowList: ['u1'],
      ownerUserId: 'u1',
      updatedBy: 'u1',
    })
    expect(initialBindingAccess({ userId: 'u1', team: undefined }).memberAllowList).toEqual(['u1'])
  })

  test('a team that shares by default opens new bindings to everyone', () => {
    expect(initialBindingAccess({ userId: 'u1', team: shared }).memberAllowList).toEqual(['*'])
  })

  test('a high-privilege binding stays private despite the team default', () => {
    const access = initialBindingAccess({ userId: 'u1', team: shared, highPrivilege: true })

    expect(access.memberAllowList).toEqual(['u1'])
  })

  test("the member's own choice wins over every default", () => {
    const share = { mode: 'members' as const, memberIds: ['u2', 'u1', 'u2'] }

    expect(initialBindingAccess({ userId: 'u1', team: shared, share }).memberAllowList).toEqual([
      'u1',
      'u2',
    ])
    expect(
      initialBindingAccess({
        userId: 'u1',
        team: closed,
        share: { mode: 'team', memberIds: [] },
        highPrivilege: true,
      }).memberAllowList,
    ).toEqual(['*'])
  })
})

describe('newBindingAccess', () => {
  const app = new Hono<{ Variables: TeamAuthVariables }>()

  app.use('*', async (c, next) => {
    c.set('userId', 'u1')
    c.set('team', closed as NuphosTeam)
    await next()
  })
  app.post('/', async (c) => c.json(await newBindingAccess(c)))
  app.onError(errorHandler)
  const post = (body: unknown) =>
    app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  test('reads the choice from the body next to the binding fields', async () => {
    const response = await post({ label: 'x', share: { mode: 'members', memberIds: ['u2'] } })

    expect(await response.json()).toMatchObject({ memberAllowList: ['u1', 'u2'] })
  })

  test('falls back to the team default without a choice', async () => {
    expect(await (await post({ label: 'x' })).json()).toMatchObject({ memberAllowList: ['u1'] })
  })

  test('refuses a choice it does not know', async () => {
    expect((await post({ share: { mode: 'everyone' } })).status).toBe(400)
  })
})
