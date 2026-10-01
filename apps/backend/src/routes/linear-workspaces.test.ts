import { afterEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { errorHandler } from '@/lib/errors'
import { useByosSecrets } from '@/lib/test/doubles/byos-secrets'
import { useModels } from '@/lib/test/doubles/models'

import type { TeamAuthVariables } from '@/middleware/auth'

useByosSecrets({
  decryptLinearSecret: () => 'test-access-token',
})

const TEAM_ID = new ObjectId()
const BINDING_ID = new ObjectId()

function binding(overrides: Record<string, unknown> = {}) {
  return {
    id: BINDING_ID,
    label: 'Nuphos',
    workspaceId: 'workspace-1',
    workspaceName: 'Nuphos',
    organizationUrlKey: 'nuphos',
    accountId: 'account-1',
    accountName: 'Yuanlin',
    scope: 'read,write',
    encryptedAccessToken: 'test-access-token',
    encryptedRefreshToken: undefined,
    accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    access: { memberAllowList: ['*'], updatedAt: new Date(), updatedBy: 'admin-user' },
    createdAt: new Date(),
    ...overrides,
  }
}

let stored: { linearWorkspaces: unknown[] } = { linearWorkspaces: [binding()] }

useModels({
  teamByosBindings: () => ({
    findOne: async () => stored,
  }),
})

const { linearWorkspacesRoutes } = await import('@/routes/linear-workspaces')

const app = new Hono<{ Variables: TeamAuthVariables }>()

app.use('*', async (c, next) => {
  c.set('teamId', TEAM_ID.toHexString())
  c.set('userId', 'admin-user')
  c.set('teamRole', 'ADMINISTRATOR')
  await next()
})
app.route('/', linearWorkspacesRoutes)
app.onError(errorHandler)

const realFetch = globalThis.fetch

function installLinearGraphql(handler: (body: { query: string; variables: unknown }) => unknown) {
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}

    return new Response(JSON.stringify(handler(body)), {
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = realFetch
  stored = { linearWorkspaces: [binding()] }
})

describe('GET /:bindingId/issues/:identifier', () => {
  test('returns a normalized issue', async () => {
    installLinearGraphql(() => ({
      data: {
        issue: {
          identifier: 'NUPS-123',
          title: 'Ship the Linear viewer',
          description: 'Body text',
          priority: 2,
          priorityLabel: 'High',
          url: 'https://linear.app/nuphos/issue/NUPS-123',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          state: { name: 'In Progress', type: 'started', color: '#000' },
          assignee: { name: 'Yuanlin', avatarUrl: 'https://example.com/a.png' },
          team: { id: 'team-uuid', key: 'NUPS', name: 'Nuphos' },
          labels: { nodes: [{ id: 'l1', name: 'bug', color: '#f00' }] },
          project: { name: 'Desktop' },
          cycle: { name: null, number: 7 },
          comments: {
            nodes: [
              {
                id: 'c1',
                body: 'A comment',
                createdAt: '2026-01-01T01:00:00.000Z',
                user: { name: 'Reviewer', avatarUrl: null },
              },
            ],
          },
        },
      },
    }))

    const res = await app.request(`/${BINDING_ID.toHexString()}/issues/NUPS-123`)

    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      identifier: string
      title: string
      state: unknown
      assignee: unknown
      project: string | null
      cycle: string | null
      team: unknown
      comments: unknown
    }

    expect(json.identifier).toBe('NUPS-123')
    expect(json.title).toBe('Ship the Linear viewer')
    expect(json.state).toEqual({ name: 'In Progress', type: 'started', color: '#000' })
    expect(json.assignee).toEqual({ name: 'Yuanlin', avatarUrl: 'https://example.com/a.png' })
    expect(json.project).toBe('Desktop')
    expect(json.cycle).toBe('Cycle 7')
    expect(json.team).toEqual({
      id: 'team-uuid',
      key: 'NUPS',
      name: 'Nuphos',
      url: 'https://linear.app/nuphos/team/NUPS',
    })
    expect(json.comments).toEqual([
      {
        id: 'c1',
        body: 'A comment',
        createdAt: '2026-01-01T01:00:00.000Z',
        author: 'Reviewer',
        authorAvatarUrl: null,
      },
    ])
  })

  test('404s when Linear returns no issue', async () => {
    installLinearGraphql(() => ({ data: { issue: null } }))

    const res = await app.request(`/${BINDING_ID.toHexString()}/issues/NUPS-999`)

    expect(res.status).toBe(404)
    const json = (await res.json()) as { error: { code: string } }

    expect(json.error.code).toBe('linear_issue_not_found')
  })

  test('400s on a malformed identifier', async () => {
    const res = await app.request(`/${BINDING_ID.toHexString()}/issues/not-an-identifier`)

    expect(res.status).toBe(400)
  })

  test('403s when the caller is not on the binding allow-list', async () => {
    stored = { linearWorkspaces: [binding({ access: { memberAllowList: ['someone-else'] } })] }

    const res = await app.request(`/${BINDING_ID.toHexString()}/issues/NUPS-123`)

    expect(res.status).toBe(403)
    const json = (await res.json()) as { error: { code: string } }

    expect(json.error.code).toBe('linear_workspace_access_denied')
  })
})

describe('GET /:bindingId/teams', () => {
  test('returns the teams sorted by name', async () => {
    installLinearGraphql(() => ({
      data: {
        teams: {
          nodes: [
            { id: 't2', key: 'WEB', name: 'Web', color: '#0f0' },
            { id: 't1', key: 'API', name: 'Api', color: null },
          ],
        },
      },
    }))

    const res = await app.request(`/${BINDING_ID.toHexString()}/teams`)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      teams: [
        {
          id: 't1',
          key: 'API',
          name: 'Api',
          color: null,
          url: 'https://linear.app/nuphos/team/API',
        },
        {
          id: 't2',
          key: 'WEB',
          name: 'Web',
          color: '#0f0',
          url: 'https://linear.app/nuphos/team/WEB',
        },
      ],
    })
  })

  test('403s when the caller is not on the binding allow-list', async () => {
    stored = { linearWorkspaces: [binding({ access: { memberAllowList: ['someone-else'] } })] }

    const res = await app.request(`/${BINDING_ID.toHexString()}/teams`)

    expect(res.status).toBe(403)
  })
})

describe('GET /:bindingId/teams/:linearTeamId/issues', () => {
  const issueRow = {
    identifier: 'NUPS-1',
    title: 'First',
    url: 'https://linear.app/nuphos/issue/NUPS-1',
    priority: 1,
    priorityLabel: 'Urgent',
    updatedAt: '2026-01-02T00:00:00.000Z',
    state: { name: 'Todo', type: 'unstarted', color: '#aaa' },
    assignee: null,
  }

  test('defaults to open issues, 50 per page, and returns the next cursor', async () => {
    let variables: Record<string, unknown> = {}

    installLinearGraphql((body) => {
      variables = body.variables as Record<string, unknown>

      return {
        data: {
          team: {
            id: 'team-uuid',
            key: 'NUPS',
            name: 'Nuphos',
            issues: {
              nodes: [issueRow],
              pageInfo: { hasNextPage: true, endCursor: 'cursor-2' },
            },
          },
        },
      }
    })

    const res = await app.request(`/${BINDING_ID.toHexString()}/teams/team-uuid/issues`)

    expect(res.status).toBe(200)
    expect(variables).toEqual({
      teamId: 'team-uuid',
      first: 50,
      after: null,
      filter: { state: { type: { nin: ['completed', 'canceled'] } } },
    })
    expect(await res.json()).toEqual({
      team: {
        id: 'team-uuid',
        key: 'NUPS',
        name: 'Nuphos',
        url: 'https://linear.app/nuphos/team/NUPS',
      },
      issues: [issueRow],
      nextCursor: 'cursor-2',
    })
  })

  test('passes the cursor, limit and state=all through', async () => {
    let variables: Record<string, unknown> = {}

    installLinearGraphql((body) => {
      variables = body.variables as Record<string, unknown>

      return {
        data: {
          team: {
            id: 'team-uuid',
            key: 'NUPS',
            name: 'Nuphos',
            issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: 'x' } },
          },
        },
      }
    })

    const res = await app.request(
      `/${BINDING_ID.toHexString()}/teams/team-uuid/issues?cursor=abc&limit=10&state=all`,
    )

    expect(res.status).toBe(200)
    expect(variables).toEqual({ teamId: 'team-uuid', first: 10, after: 'abc', filter: null })
    expect(((await res.json()) as { nextCursor: unknown }).nextCursor).toBeNull()
  })

  test('404s when Linear cannot find the team', async () => {
    installLinearGraphql(() => ({ errors: [{ message: 'Entity not found: Team' }] }))

    const res = await app.request(`/${BINDING_ID.toHexString()}/teams/missing/issues`)

    expect(res.status).toBe(404)
    const json = (await res.json()) as { error: { code: string } }

    expect(json.error.code).toBe('linear_team_not_found')
  })

  test('400s on an out-of-range limit', async () => {
    const res = await app.request(`/${BINDING_ID.toHexString()}/teams/team-uuid/issues?limit=500`)

    expect(res.status).toBe(400)
  })

  test('403s when the caller is not on the binding allow-list', async () => {
    stored = { linearWorkspaces: [binding({ access: { memberAllowList: ['someone-else'] } })] }

    const res = await app.request(`/${BINDING_ID.toHexString()}/teams/team-uuid/issues`)

    expect(res.status).toBe(403)
  })
})

describe('revoked Linear authorization', () => {
  test('a 401 with nothing to refresh from answers linear_reconnect_required', async () => {
    const revokedId = new ObjectId()

    stored = { linearWorkspaces: [binding({ id: revokedId })] }
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ errors: [{ message: 'Authentication required, not authenticated' }] }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      )) as unknown as typeof fetch

    const res = await app.request(`/${revokedId.toHexString()}/issues/NUPS-123`)

    expect(res.status).toBe(409)
    const json = (await res.json()) as { error: { code: string } }

    expect(json.error.code).toBe('linear_reconnect_required')
  })

  test('a credential handout whose refresh token Linear rejects answers linear_reconnect_required', async () => {
    const revokedId = new ObjectId()
    const saved = { ...config.byos.linear }

    config.byos.linear.clientId = 'client'
    config.byos.linear.clientSecret = 'secret'
    stored = {
      linearWorkspaces: [
        binding({
          id: revokedId,
          encryptedRefreshToken: 'test-refresh-token',
          accessTokenExpiresAt: new Date(Date.now() - 1000),
        }),
      ],
    }
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: 'invalid_grant' }), {
        status: 400,
      })) as unknown as typeof fetch

    try {
      const res = await app.request(`/${revokedId.toHexString()}/credentials`)

      expect(res.status).toBe(409)
      const json = (await res.json()) as { error: { code: string } }

      expect(json.error.code).toBe('linear_reconnect_required')
    } finally {
      config.byos.linear.clientId = saved.clientId
      config.byos.linear.clientSecret = saved.clientSecret
    }
  })
})
