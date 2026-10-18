import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'
import { useCredentialRole } from '@/lib/test/doubles/byos-credential-role'

const EDITORS = new Set(['editor', 'owner-editor'])
let checked: string[] = []

useCredentialRole({
  canMintCredentials: (_teamId: string, userIds: string[]) => {
    checked = userIds

    return Promise.resolve(userIds.every((id) => EDITORS.has(id)))
  },
})

const { requireCloudCredentialRole } = await import('./shared')

function app(sender: string, owner: string) {
  const router = new Hono()

  router.use('*', async (c, next) => {
    const ctx = c as unknown as { set: (key: string, value: unknown) => void }

    ctx.set('userId', sender)
    ctx.set('teamId', 'team-1')
    ctx.set('agent', { userId: sender, sessionId: 's', conversationOwnerUserId: owner })
    await next()
  })
  router.use('*', requireCloudCredentialRole() as never)
  router.get('*', (c) => c.text('ok'))

  return router.onError(errorHandler)
}

const CREDENTIALS = '/s/teams/team-1/aws-accounts/123/credentials'

describe('requireCloudCredentialRole', () => {
  test('lets an editor sender in an editor-owned conversation through', async () => {
    expect((await app('editor', 'owner-editor').request(CREDENTIALS)).status).toBe(200)
    expect(checked).toContain('owner-editor')
  })

  test('refuses a viewer sender', async () => {
    expect((await app('viewer', 'owner-editor').request(CREDENTIALS)).status).toBe(403)
  })

  test('refuses an editor sender in a viewer-owned conversation', async () => {
    expect((await app('editor', 'viewer').request(CREDENTIALS)).status).toBe(403)
  })

  test('leaves non-credential paths alone', async () => {
    expect((await app('viewer', 'viewer').request('/s/teams/team-1/plans')).status).toBe(200)
  })
})
