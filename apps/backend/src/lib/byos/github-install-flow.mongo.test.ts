// Binding against a real MongoDB. The store doubles accept any update and return
// whatever a test hands them, so they cannot show what the database does with a
// document that lacks a field, or with an upsert whose operators overlap.
// Runs when TEST_MONGODB_URI is set, with MONGODB_URI pointing at the same server.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { closeDb, connectDb } from '@/lib/db'
import { useByosGithub } from '@/lib/test/doubles/byos-github'
import { teamByosBindings } from '@/models'

import { bindGithubInstallation } from './github-install-flow'

useByosGithub({
  getInstallation: (id: number) =>
    Promise.resolve({
      id,
      account: { id: 1, login: 'acme', type: 'Organization' },
      repositorySelection: 'all',
    } as never),
})

const access = {
  memberAllowList: ['u1'],
  ownerUserId: 'u1',
  updatedAt: new Date(),
  updatedBy: 'u1',
}

async function installations(team: ObjectId): Promise<number[] | undefined> {
  const bindings = await teamByosBindings().findOne({ _id: team })

  return bindings?.githubInstallations?.map((binding) => binding.installationId)
}

describe.skipIf(!process.env.TEST_MONGODB_URI)('bindGithubInstallation on a real database', () => {
  beforeAll(async () => {
    await connectDb()
  })
  afterAll(async () => {
    await closeDb()
  })

  // #2672: a document first written by another connector's bind route has no such field.
  test('binds into a team document that has no githubInstallations field', async () => {
    const team = new ObjectId()

    await teamByosBindings().insertOne({ _id: team, awsRoles: [] } as never)
    await bindGithubInstallation(team, 42, access)
    expect(await installations(team)).toEqual([42])
  })

  test('creates the team document when this is its first connector', async () => {
    const team = new ObjectId()

    await bindGithubInstallation(team, 42, access)
    expect(await installations(team)).toEqual([42])
    expect((await teamByosBindings().findOne({ _id: team }))?.awsRoles).toEqual([])
  })

  test('binding the same installation twice keeps one binding', async () => {
    const team = new ObjectId()

    await bindGithubInstallation(team, 42, access)
    await bindGithubInstallation(team, 42, access)
    expect(await installations(team)).toEqual([42])
  })
})
