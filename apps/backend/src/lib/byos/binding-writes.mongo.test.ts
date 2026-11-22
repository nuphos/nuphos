// Writes that check a binding's member list against a real MongoDB: each must
// apply only while the list it was allowed against is unchanged.
// Runs when TEST_MONGODB_URI is set, with MONGODB_URI pointing at the same server.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { closeDb, connectDb } from '@/lib/db'
import { errorHandler } from '@/lib/errors'
import { allowDisconnect, disconnectBinding } from '@/middleware/auth/binding-disconnect'
import { teamByosBindings } from '@/models'

import { registerBindingAccessRoutes } from './access-routes'
import { disconnectDepartedMemberBindings } from './departing-member'
import { appendCheckedBinding } from './environment-bindings'

import type { TeamAuthVariables } from '@/middleware/auth/types'
import type { BindingAccess } from '@/models'
import type { Context } from 'hono'

const listOf = (memberAllowList: string[], ownerUserId = 'owner', at = 1): BindingAccess => ({
  memberAllowList,
  ownerUserId,
  updatedAt: new Date(at),
  updatedBy: ownerUserId,
})
let roleCount = 0
const role = (
  access?: BindingAccess,
  roleArn = `arn:aws:iam::123456789012:role/r${String(++roleCount)}`,
) => ({
  id: new ObjectId(),
  roleArn,
  createdAt: new Date(),
  ...(access && { access }),
})

async function teamWith(awsRoles: ReturnType<typeof role>[]): Promise<ObjectId> {
  const team = new ObjectId()

  await teamByosBindings().insertOne({ _id: team, awsRoles, updatedAt: new Date() } as never)

  return team
}

const rolesOf = async (team: ObjectId) =>
  (await teamByosBindings().findOne({ _id: team }))?.awsRoles ?? []

/** A request context as the routes see it, for an admin. */
function adminContext(team: ObjectId): Context {
  const values = new Map<string, unknown>([
    ['teamId', team.toHexString()],
    ['userId', 'admin'],
    ['teamRole', 'ADMINISTRATOR'],
  ])

  return { get: (key: string) => values.get(key) } as unknown as Context
}

describe.skipIf(!process.env.TEST_MONGODB_URI)('binding writes on a real database', () => {
  beforeAll(async () => {
    await connectDb()
  })
  afterAll(async () => {
    await closeDb()
  })

  test('a disconnect removes the binding while its list is the one it was allowed against', async () => {
    const shared = role(listOf(['owner', 'teammate']))
    const legacy = role()
    const team = await teamWith([shared, legacy])

    for (const binding of [shared, legacy]) {
      const c = adminContext(team)

      allowDisconnect(c, binding.access)
      expect((await disconnectBinding(c, team, 'awsRoles', { id: binding.id })).matchedCount).toBe(
        1,
      )
    }
    expect(await rolesOf(team)).toEqual([])
  })

  test('a disconnect is refused when its owner made the binding private in between', async () => {
    const binding = role(listOf(['owner', 'teammate']))
    const team = await teamWith([binding])
    const c = adminContext(team)

    allowDisconnect(c, binding.access)
    await teamByosBindings().updateOne(
      { _id: team, 'awsRoles.id': binding.id },
      { $set: { 'awsRoles.$.access': listOf(['owner'], 'owner', 2) } },
    )
    await expect(disconnectBinding(c, team, 'awsRoles', { id: binding.id })).rejects.toMatchObject({
      status: 409,
      code: 'binding_access_changed',
    })
    expect((await rolesOf(team)).map((b) => b.id)).toEqual([binding.id])
  })

  test('a list edit is refused when the list changed after it was allowed', async () => {
    const binding = role(listOf(['owner', 'teammate']))
    const team = await teamWith([binding])
    const app = new Hono<{ Variables: TeamAuthVariables }>()

    app.use('*', async (c, next) => {
      c.set('teamId', team.toHexString())
      c.set('userId', 'admin')
      c.set('teamRole', 'ADMINISTRATOR')
      await next()
    })
    // The admin's edit was allowed against the shared list it read first.
    registerBindingAccessRoutes(app, 'awsRoles', () => binding)
    app.onError(errorHandler)
    await teamByosBindings().updateOne(
      { _id: team, 'awsRoles.id': binding.id },
      { $set: { 'awsRoles.$.access': listOf(['owner'], 'owner', 2) } },
    )
    const response = await app.request('/access', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ memberAllowList: ['*'] }),
    })

    expect(response.status).toBe(409)
    expect((await rolesOf(team))[0]?.access?.memberAllowList).toEqual(['owner'])
  })

  test('a bind checks again when another write lands between its check and its append', async () => {
    const team = await teamWith([])
    const arn = 'arn:aws:iam::123456789012:role/shared-name'
    let checks = 0
    const check = async (roles: { roleArn: string }[]) => {
      checks++
      if (roles.some((b) => b.roleArn.toLowerCase() === arn.toLowerCase())) {
        throw new Error('held privately')
      }
      // Another member's private bind of the same role, in another spelling,
      // lands after this check passed and before the append.
      if (checks === 1) {
        await teamByosBindings().updateOne(
          { _id: team },
          {
            $push: { awsRoles: role(listOf(['owner']), arn.toUpperCase()) },
            $set: { updatedAt: new Date() },
          },
        )
      }
    }

    await expect(
      appendCheckedBinding(
        team,
        'awsRoles',
        check,
        { 'awsRoles.roleArn': { $ne: arn } },
        {
          $push: { awsRoles: role(listOf(['admin'], 'admin'), arn) },
          $set: { updatedAt: new Date() },
        },
      ),
    ).rejects.toThrow('held privately')
    expect(checks).toBe(2)
    expect((await rolesOf(team)).map((b) => b.roleArn)).toEqual([arn.toUpperCase()])
  })

  test("a departing member's private bindings are disconnected, and nothing else", async () => {
    const theirs = role(listOf(['owner']))
    const sharedByThem = role(listOf(['owner', 'teammate']))
    const someoneElses = role(listOf(['teammate'], 'teammate'))
    const team = await teamWith([theirs, sharedByThem, someoneElses])

    const disconnected = await disconnectDepartedMemberBindings(team, 'owner', {
      actorUserId: 'admin',
      via: 'team_removal',
    })

    expect(disconnected).toEqual([{ collection: 'awsRoles', bindingId: theirs.id.toHexString() }])
    expect((await rolesOf(team)).map((b) => b.id)).toEqual([sharedByThem.id, someoneElses.id])
  })
})
