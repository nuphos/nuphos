import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { signInstallFlowState, verifyInstallFlowState } from '@/lib/byos/github-install-flow'
import { AppError } from '@/lib/errors'
import { useByosGithub } from '@/lib/test/doubles/byos-github'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useModels } from '@/lib/test/doubles/models'
import { usePersonalCredentialsGithub } from '@/lib/test/doubles/personal-credentials-github'

import { githubAppRoutes } from './github-app'
import { githubInstallationsRoutes } from './github-installations'

const TEAM = new ObjectId()
const ADMIN = 'admin-user'
const OTHER_INSTALLATION = 7
const OWN_INSTALLATION = 42

let bindings: { _id: ObjectId; githubInstallations: { installationId: number }[] } | null
let revoked: string[]

useModels({
  teamByosBindings: () => ({
    findOne: () => Promise.resolve(bindings),
    updateOne: (_filter: unknown, update: { $push: { githubInstallations: never } }) => {
      bindings ??= { _id: TEAM, githubInstallations: [] }
      bindings.githubInstallations.push(update.$push.githubInstallations)

      return Promise.resolve({ modifiedCount: 1, upsertedCount: 0 })
    },
  }),
})
useIdentity({
  getTeamMembership: (userId: string) =>
    Promise.resolve(
      userId === ADMIN ? ({ role: 'ADMINISTRATOR', team: { name: 'Acme Team' } } as never) : null,
    ),
})
useByosGithub({
  getInstallation: (id: number) =>
    Promise.resolve({
      account: { login: 'acme', type: 'Organization', id: 1 },
      repositorySelection: 'all',
      id,
    } as never),
})
usePersonalCredentialsGithub({
  exchangeGithubCode: ({ code }: { code: string }) =>
    Promise.resolve({ accessToken: `tok-${code}`, refreshToken: null, expiresAt: null }),
  // The GitHub user behind every code here can access only their own installation.
  githubUserInstallationIds: () => Promise.resolve([OWN_INSTALLATION]),
  revokeGithubToken: (token: string) => {
    revoked.push(token)

    return Promise.resolve()
  },
})

const saved = {
  github: { ...config.byos.github },
  jwtSecret: config.auth.jwtSecret,
  publicBackendUrl: config.agent.publicBackendUrl,
}

Object.assign(config.byos.github, {
  appSlug: 'nuphos',
  clientId: 'Iv1.client',
  clientSecret: 'gh-secret',
  setupRedirect: 'https://app.nuphos.test/github-callback',
})
Object.assign(config.auth, { jwtSecret: 'test-secret' })
Object.assign(config.agent, { publicBackendUrl: 'https://api.nuphos.test' })
afterAll(() => {
  Object.assign(config.byos.github, saved.github)
  Object.assign(config.auth, { jwtSecret: saved.jwtSecret })
  Object.assign(config.agent, { publicBackendUrl: saved.publicBackendUrl })
})

const app = new Hono()

app.route('/github-app', githubAppRoutes)
app.use('/teams/:teamId/*', async (c, next) => {
  c.set('teamId' as never, c.req.param('teamId'))
  c.set('teamRole' as never, 'ADMINISTRATOR')
  c.set('userId' as never, ADMIN)
  await next()
})
app.route('/teams/:teamId/github-installations', githubInstallationsRoutes)
app.onError((err, c) =>
  err instanceof AppError ? c.json({ code: err.code }, err.status as 400) : c.text('boom', 500),
)

beforeEach(() => {
  bindings = null
  revoked = []
})

function cookieOf(res: Response): string {
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
}

/**
 * Walks a flow from the client's ticket to the confirm page. `browser` is the
 * cookie the finishing browser presents; by default the one that opened it.
 */
async function runFlow(installationId: number, opts: { browser?: string } = {}) {
  const ticket = signInstallFlowState({ t: TEAM.toHexString(), u: ADMIN })
  const install = await app.request(`/github-app/install?ticket=${ticket}&state=client-nonce`)
  const opener = cookieOf(install)
  const installState = new URL(install.headers.get('location') ?? '').searchParams.get('state')
  const setup = await app.request(
    `/github-app/setup?installation_id=${String(installationId)}&setup_action=install&state=${installState ?? ''}`,
    { headers: { cookie: opener } },
  )
  const authorize = new URL(setup.headers.get('location') ?? '')
  const done = await app.request(
    `/github-app/setup?code=abc&state=${authorize.searchParams.get('state') ?? ''}`,
    { headers: { cookie: opts.browser ?? opener } },
  )

  return { install, opener, authorize, done }
}

function confirm(page: string, cookie: string) {
  const state = /name="state" value="([^"]+)"/u.exec(page)?.[1] ?? ''

  return app.request('/github-app/confirm', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ state }).toString(),
  })
}

describe('GitHub installation flow', () => {
  test('binds after the GitHub user proves access and confirms the team', async () => {
    const { install, opener, authorize, done } = await runFlow(OWN_INSTALLATION)

    expect(install.headers.get('location')).toStartWith(
      'https://github.com/apps/nuphos/installations/new?state=',
    )
    expect(authorize.origin + authorize.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(authorize.searchParams.get('redirect_uri')).toBe(
      'https://api.nuphos.test/github-app/setup',
    )

    const page = await done.text()

    expect(page).toContain('Acme Team')
    expect(page).toContain('acme')
    expect(bindings).toBeNull()
    expect(revoked).toEqual(['tok-abc'])

    const confirmed = await confirm(page, opener)
    const back = new URL(confirmed.headers.get('location') ?? '')

    expect(back.origin + back.pathname).toBe('https://app.nuphos.test/github-callback')
    expect(back.searchParams.get('installation_id')).toBe(String(OWN_INSTALLATION))
    expect(back.searchParams.get('state')).toBe('client-nonce')
    expect(bindings?.githubInstallations.map((b) => b.installationId)).toEqual([OWN_INSTALLATION])
  })

  test("does not bind an installation the GitHub user can't access", async () => {
    const { done } = await runFlow(OTHER_INSTALLATION)

    expect(done.status).toBe(302)
    expect(bindings).toBeNull()
    expect(revoked).toEqual(['tok-abc'])
  })

  test('a flow finished in a different browser does not bind', async () => {
    const { done } = await runFlow(OWN_INSTALLATION, { browser: '' })

    expect(done.status).toBe(400)
    expect(bindings).toBeNull()
  })

  test('confirming needs the same browser', async () => {
    const { done } = await runFlow(OWN_INSTALLATION)

    expect((await confirm(await done.text(), 'nuphos_github_install=other')).status).toBe(400)
    expect(bindings).toBeNull()
  })

  test('confirming needs a state GitHub verified', async () => {
    const { opener, authorize } = await runFlow(OWN_INSTALLATION)
    const unverified = authorize.searchParams.get('state') ?? ''

    expect((await confirm(`name="state" value="${unverified}"`, opener)).status).toBe(400)
    expect(bindings).toBeNull()
  })

  test('a verified state cannot be re-pointed at another installation', async () => {
    const { opener, done } = await runFlow(OWN_INSTALLATION)
    const verified = /name="state" value="([^"]+)"/u.exec(await done.text())?.[1] ?? ''
    const repointed = await app.request(
      `/github-app/setup?installation_id=${String(OTHER_INSTALLATION)}&state=${verified}`,
      { headers: { cookie: opener } },
    )

    expect(repointed.status).toBe(400)
    const leaked = new URL(repointed.headers.get('location') ?? 'https://x.test').searchParams

    expect(
      (await confirm(`name="state" value="${leaked.get('state') ?? ''}"`, opener)).status,
    ).toBe(400)
    expect(bindings).toBeNull()
  })

  test('rejects a forged or tampered state', async () => {
    const res = await app.request('/github-app/setup?installation_id=7&state=forged.sig')

    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_github_install_state')

    const real = signInstallFlowState({ t: TEAM.toHexString(), u: ADMIN })
    const [payload, sig] = real.split('.')
    const tampered = Buffer.from(
      JSON.stringify({ ...verifyInstallFlowState(real), t: new ObjectId().toHexString() }),
    ).toString('base64url')

    expect(payload).not.toBe(tampered)
    expect(verifyInstallFlowState(`${tampered}.${sig ?? ''}`)).toBeNull()
  })

  test('rejects a callback without the signed state', async () => {
    const res = await app.request('/github-app/setup?installation_id=42&setup_action=install')

    expect(res.status).toBe(400)
  })
})

function bind(installationId: number) {
  return app.request(`/teams/${TEAM.toHexString()}/github-installations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ installationId }),
  })
}

describe('POST /teams/:teamId/github-installations', () => {
  test('refuses an installation the setup callback did not bind', async () => {
    const res = await bind(OTHER_INSTALLATION)

    expect(res.status).toBe(403)
    expect(bindings).toBeNull()
  })

  test('confirms an installation the setup callback bound', async () => {
    const { opener, done } = await runFlow(OWN_INSTALLATION)

    await confirm(await done.text(), opener)
    const res = await bind(OWN_INSTALLATION)

    expect(res.status).toBe(201)
    expect(((await res.json()) as { installationId: number }).installationId).toBe(OWN_INSTALLATION)
  })

  test('install-url starts the flow on the backend with a signed ticket', async () => {
    const res = await app.request(
      `/teams/${TEAM.toHexString()}/github-installations/install-url?state=android-nonce`,
    )
    const url = new URL(((await res.json()) as { url: string }).url)

    expect(url.origin + url.pathname).toBe('https://api.nuphos.test/github-app/install')
    expect(verifyInstallFlowState(url.searchParams.get('ticket') ?? '')).toMatchObject({
      t: TEAM.toHexString(),
      u: ADMIN,
      s: 'android-nonce',
    })
  })
})
