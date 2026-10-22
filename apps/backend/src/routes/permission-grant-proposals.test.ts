import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { usePermissionGrants } from '@/lib/test/doubles/permission-grants'

const proposal = {
  _id: new ObjectId(),
  status: 'pending',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  createdByUserId: 'proposer',
}

usePermissionGrants({
  getPermissionGrantProposal: async () => proposal as never,
  proposalDecisions: () => [] as never,
  getProposalChanges: () => [] as never,
  proposalSummaryLabel: () => 'summary',
})

const { permissionGrantProposalsRoutes } = await import('./permission-grant-proposals')

function read(userId: string, teamRole: string) {
  const app = new Hono()

  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    const ctx = c as unknown as { set: (key: string, value: unknown) => void }

    ctx.set('teamId', 'team-1')
    ctx.set('userId', userId)
    ctx.set('teamRole', teamRole)
    await next()
  })
  app.route('/', permissionGrantProposalsRoutes as never)

  return app.request('/p1')
}

describe('GET /permission-grant-proposals/:id', () => {
  test('the proposer can read it', async () => {
    expect((await read('proposer', 'EDITOR')).status).toBe(200)
  })

  test('an administrator can read it', async () => {
    expect((await read('admin', 'ADMINISTRATOR')).status).toBe(200)
  })

  test.each(['EDITOR', 'VIEWER'])('another %s cannot read it', async (role) => {
    expect((await read('someone-else', role)).status).toBe(404)
  })
})
