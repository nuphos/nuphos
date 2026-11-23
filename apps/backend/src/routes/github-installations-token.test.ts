import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { mintPreviewMcpToken } from '@/lib/claude-code-preview/mcp-token'
import { AppError } from '@/lib/errors'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useByosAccount } from '@/lib/test/doubles/byos-account'
import { useByosGithub } from '@/lib/test/doubles/byos-github'
import { useByosSecrets } from '@/lib/test/doubles/byos-secrets'
import { useGithubHttp } from '@/lib/test/doubles/github-http'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useModels } from '@/lib/test/doubles/models'

import { githubInstallationsRoutes } from './github-installations'

import type { AgentConversation } from '@/lib/agent/db'
import type { EncryptedSecret } from '@/lib/byos/secrets'

// The token route runs against the real Personal Credential handout; only
// GitHub's HTTP API, storage and the team App token are doubles.
const TEAM = new ObjectId().toHexString()
const INSTALLATION = 7
const MEMBER = 'member-1'

let installations: () => Response

useGithubHttp({
  githubFetch: (url: string) =>
    Promise.resolve(
      url.includes('/user/installations') ? installations() : new Response(null, { status: 404 }),
    ),
})
useByosAccount({
  findGithubInstallation: () =>
    Promise.resolve({ installationId: INSTALLATION, accountLogin: 'acme' } as never),
})
useByosGithub({
  getInstallationToken: () => Promise.resolve({ token: 'ghs_team', expiresAt: new Date() }),
})
useIdentity({ getNuphosUserById: () => Promise.resolve(null) })
useAgentDb({
  getConversationBySessionId: (sessionId: string) =>
    Promise.resolve({ sessionId } as unknown as AgentConversation),
  credentialSource: (conversation: unknown) => Promise.resolve(conversation),
})
useByosSecrets({
  decryptGithubSecret: (envelope: EncryptedSecret) =>
    (envelope as unknown as { plaintext: string }).plaintext,
})
useModels({
  personalCredentials: () => ({
    find: () => ({
      toArray: () =>
        Promise.resolve([
          {
            _id: new ObjectId(),
            userId: MEMBER,
            provider: 'github',
            login: 'octocat',
            encryptedAccessToken: { plaintext: 'ghu_member' },
            accessTokenExpiresAt: null,
          },
        ]),
    }),
  }),
})

const app = new Hono()

app.use('/teams/:teamId/*', async (c, next) => {
  c.set('teamId' as never, c.req.param('teamId'))
  c.set('teamRole' as never, 'ADMINISTRATOR')
  c.set('userId' as never, MEMBER)
  await next()
})
app.route('/teams/:teamId/github-installations', githubInstallationsRoutes)
app.onError((err, c) =>
  err instanceof AppError
    ? c.json({ code: err.code, message: err.message }, err.status as 400)
    : c.text('boom', 500),
)

async function requestToken() {
  const authorization = `Bearer ${await mintPreviewMcpToken({
    userId: MEMBER,
    sessionId: 'conv-1',
    teamId: TEAM,
    humanTurn: true,
  })}`

  return app.request(`/teams/${TEAM}/github-installations/${String(INSTALLATION)}/token`, {
    headers: { Authorization: authorization },
  })
}

beforeEach(() => {
  installations = () => Response.json({ installations: [{ id: INSTALLATION }] })
})

describe('GET /github-installations/:id/token for a member with a Personal Credential', () => {
  test('acts as the member when GitHub lists the installation for them', async () => {
    const res = await requestToken()

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      token: 'ghu_member',
      actor: { kind: 'personal', login: 'octocat' },
    })
  })

  test('fails instead of handing out the team App when GitHub refuses the lookup', async () => {
    installations = () =>
      Response.json({ message: 'Resource not accessible by integration' }, { status: 403 })

    const res = await requestToken()

    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({
      code: 'github_api_error',
      message: expect.stringContaining('Resource not accessible by integration'),
    })
  })
})
