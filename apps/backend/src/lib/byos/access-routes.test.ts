import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useModels } from '@/lib/test/doubles/models'

import { registerBindingAccessRoutes } from './access-routes'

import type { TeamAuthVariables } from '@/middleware/auth/types'

const teamId = new ObjectId().toHexString()
const bindingId = new ObjectId()
let updates: { filter: Record<string, unknown>; update: Record<string, unknown> }[] = []
let matchedCount = 1
let memberAllowList = ['u1', 'u2']
let ownerUserId: string | undefined = 'u1'

useModels({
  teamByosBindings: () => ({
    updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      updates.push({ filter, update })

      return { matchedCount }
    },
  }),
})

beforeEach(() => {
  updates = []
  matchedCount = 1
  memberAllowList = ['u1', 'u2']
  ownerUserId = 'u1'
})

function app(role: 'ADMINISTRATOR' | 'EDITOR', userId = 'admin') {
  const scoped = new Hono<{ Variables: TeamAuthVariables }>()

  scoped.use('*', async (c, next) => {
    c.set('teamId', teamId)
    c.set('teamRole', role)
    c.set('userId', userId)
    await next()
  })
  registerBindingAccessRoutes(scoped, 'linodeAccounts', () => ({
    id: bindingId.toHexString(),
    access: { memberAllowList, ownerUserId, updatedAt: new Date(0), updatedBy: 'u1' },
  }))

  return scoped.onError(errorHandler)
}

const put = (role: 'ADMINISTRATOR' | 'EDITOR', memberAllowList: string[], userId = 'admin') =>
  app(role, userId).request('/access', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memberAllowList }),
  })

describe('registerBindingAccessRoutes', () => {
  test('shows admins the member list', async () => {
    const response = await app('ADMINISTRATOR').request('/access')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ memberAllowList: ['u1', 'u2'], updatedBy: 'u1' })
  })

  test('keeps the list from editors who do not own the binding', async () => {
    expect((await app('EDITOR').request('/access')).status).toBe(403)
    expect((await put('EDITOR', ['*'])).status).toBe(403)
    expect(updates).toEqual([])
  })

  test('saves the list on the binding it names', async () => {
    const response = await put('ADMINISTRATOR', ['u1', 'u2', 'u1'])

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      memberAllowList: ['u1', 'u2'],
      updatedBy: 'admin',
    })
    expect(updates[0]?.filter).toEqual({
      _id: new ObjectId(teamId),
      'linodeAccounts.id': bindingId,
    })
    expect(updates[0]?.update.$set).toMatchObject({
      'linodeAccounts.$.access': {
        memberAllowList: ['u1', 'u2'],
        ownerUserId: 'u1',
        updatedBy: 'admin',
      },
    })
  })

  test("refuses '*' next to member ids", async () => {
    expect((await put('ADMINISTRATOR', ['*', 'u1'])).status).toBe(400)
  })

  test('reports a binding disconnected meanwhile', async () => {
    matchedCount = 0
    expect((await put('ADMINISTRATOR', ['u1'])).status).toBe(404)
  })

  test("lets an admin see, but not share, another member's private binding", async () => {
    memberAllowList = ['u1']
    expect((await app('ADMINISTRATOR').request('/access')).status).toBe(200)
    expect((await put('ADMINISTRATOR', ['*'])).status).toBe(403)
    ownerUserId = undefined
    expect((await put('ADMINISTRATOR', ['*'])).status).toBe(403)
    expect(updates).toEqual([])
  })

  test('lets an admin who owns a private binding share it', async () => {
    memberAllowList = ['admin']
    ownerUserId = 'admin'
    expect((await put('ADMINISTRATOR', ['*'])).status).toBe(200)
  })

  test('lets an editor who owns the binding see and change who may use it', async () => {
    memberAllowList = ['u1']
    expect((await app('EDITOR', 'u1').request('/access')).status).toBe(200)
    expect((await put('EDITOR', ['u1', 'u2'], 'u1')).status).toBe(200)
  })

  test('lets the owner reopen a list that was emptied', async () => {
    memberAllowList = []
    expect((await put('EDITOR', ['u1'], 'u1')).status).toBe(200)
  })

  test('treats the one member of an older private list as its owner', async () => {
    memberAllowList = ['u1']
    ownerUserId = undefined
    expect((await app('EDITOR', 'u1').request('/access')).status).toBe(200)
    expect((await put('EDITOR', ['*'], 'u1')).status).toBe(200)
    expect((await app('EDITOR', 'u2').request('/access')).status).toBe(403)
  })
})
