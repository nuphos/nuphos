import { afterEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { useModels } from '@/lib/test/doubles/models'

type Ready = Record<string, unknown> & { _id: string }
const staged = new Map<string, Ready>()

useModels({
  connectorOAuthReady: () =>
    ({
      insertOne: (doc: Ready) => {
        staged.set(doc._id, doc)

        return Promise.resolve({ acknowledged: true })
      },
      findOneAndDelete: (filter: {
        _id: string
        codeHash: string
        teamId: ObjectId
        requesterUserId: string
        expiresAt: { $gt: Date }
      }) => {
        const doc = staged.get(filter._id)
        const match =
          doc &&
          (doc.expiresAt as Date) > filter.expiresAt.$gt &&
          doc.codeHash === filter.codeHash &&
          String(doc.teamId) === String(filter.teamId) &&
          doc.requesterUserId === filter.requesterUserId

        if (!match) return Promise.resolve(null)
        staged.delete(filter._id)

        return Promise.resolve(doc)
      },
    }) as never,
})

const { claimConnectorOAuth, finishConnectorOAuth } = await import('./connector-oauth')

const TEAM = new ObjectId()
let persisted = 0
const persist = () => {
  persisted++

  return Promise.resolve({ binding_id: 'b1' })
}

afterEach(() => {
  config.byos.connectorOAuthDeferredBind = false
  staged.clear()
  persisted = 0
})

describe('finishConnectorOAuth', () => {
  test('binds straight away while deferred binding is off', async () => {
    const params = await finishConnectorOAuth({
      provider: 'linear',
      state: 's1',
      teamId: TEAM,
      requesterUserId: 'alice',
      draft: {},
      persist,
    })

    expect(params).toEqual({ state: 's1', binding_id: 'b1' })
    expect(persisted).toBe(1)
  })

  test('only stages the grant when deferred binding is on', async () => {
    config.byos.connectorOAuthDeferredBind = true
    const params = await finishConnectorOAuth({
      provider: 'linear',
      state: 's2',
      teamId: TEAM,
      requesterUserId: 'alice',
      draft: { workspaceId: 'w' },
      persist,
    })

    expect(params).toMatchObject({ state: 's2', deferred: '1' })
    expect(params.code?.length).toBeGreaterThan(20)
    expect(persisted).toBe(0)
    expect(staged.get('s2')).toMatchObject({ provider: 'linear', requesterUserId: 'alice' })
  })
})

describe('claimConnectorOAuth', () => {
  async function stage() {
    config.byos.connectorOAuthDeferredBind = true

    return finishConnectorOAuth({
      provider: 'linear',
      state: 's3',
      teamId: TEAM,
      requesterUserId: 'requester',
      draft: {},
      persist,
    })
  }

  test('the requester cannot complete without the callback code', async () => {
    // Knowing the state is not enough: only the client the provider redirected
    // receives the code.
    await stage()

    await expect(
      claimConnectorOAuth({ state: 's3', code: 'guess', teamId: TEAM, userId: 'requester' }),
    ).rejects.toMatchObject({ code: 'oauth_not_ready' })
  })

  test('the code alone is not enough for another user', async () => {
    const { code = '' } = await stage()

    await expect(
      claimConnectorOAuth({ state: 's3', code, teamId: TEAM, userId: 'other-user' }),
    ).rejects.toMatchObject({ code: 'oauth_not_ready' })
  })

  test('the requester holding the callback code completes once', async () => {
    const { code = '' } = await stage()

    expect(
      await claimConnectorOAuth({ state: 's3', code, teamId: TEAM, userId: 'requester' }),
    ).toMatchObject({
      provider: 'linear',
    })
    await expect(
      claimConnectorOAuth({ state: 's3', code, teamId: TEAM, userId: 'requester' }),
    ).rejects.toMatchObject({ code: 'oauth_not_ready' })
  })

  test('a grant staged for another team is not claimable', async () => {
    const { code = '' } = await stage()

    await expect(
      claimConnectorOAuth({ state: 's3', code, teamId: new ObjectId(), userId: 'requester' }),
    ).rejects.toMatchObject({ code: 'oauth_not_ready' })
  })

  test('an expired grant is not claimable', async () => {
    const { code = '' } = await stage()
    const doc = staged.get('s3')

    if (doc) doc.expiresAt = new Date(Date.now() - 1000)
    await expect(
      claimConnectorOAuth({ state: 's3', code, teamId: TEAM, userId: 'requester' }),
    ).rejects.toMatchObject({ code: 'oauth_not_ready' })
  })
})
