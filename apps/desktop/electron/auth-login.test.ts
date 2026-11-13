import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test, mock, before, beforeEach, after } from 'node:test'

import yaml from 'js-yaml'

import type { UserInfo } from './auth-status.ts'

// Run with: pnpm test
// (node --experimental-strip-types --experimental-test-module-mocks --test ...)
//
// Drives login() end to end over a real loopback HTTP request, with `electron`,
// the config file, and the backend mocked out.
//
// A backend that does not offer a provider fails the sign-in before any
// browser opens.

const USER: UserInfo = {
  id: '507f1f77bcf86cd799439011',
  name: 'Bruce',
  email: 'bruce@example.com',
  username: 'bruce',
}

const TOKEN = 'nus_test-session'
const HANDLE = 'h'.repeat(43)
/** What the backend puts on the loopback redirect after a real sign-in. */
const DELIVERY_CODE = 'd'.repeat(43)

const openedUrls: string[] = []
const configWrites: string[] = []
const files = new Map<string, string>()

/** What the fake backend was asked to register, so tests can assert on PKCE. */
type Registration = {
  redirectUri: string
  codeChallenge: string
  codeChallengeMethod: string
  clientState: string
}
let registrations: Registration[] = []

// Per-test switches for the fake servers.
let nativeSupported = true
/** How the backend answers the provider chooser probe. */
let chooserProbe: () => Response = () =>
  new Response('provider chooser', {
    headers: { 'X-Nuphos-Social-Login': '1', 'X-Nuphos-Social-Providers': 'google,apple' },
  })
let redeemQueue: (() => Response)[] = []
let redeemCalls = 0
/** Bodies POSTed to /auth/native/session/redeem, so tests can assert on them. */
let redeemBodies: { handle: string; codeVerifier: string; code?: string }[] = []
let meHandler: () => Promise<Response> = async () => json(USER)
/** Set to make creating the sign-in folder fail, as a `~/.config` owned by root does. */
let mkdirError: NodeJS.ErrnoException | null = null

let auth: typeof import('./auth.ts')
const realFetch = globalThis.fetch

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** DELETE /auth/sessions/current calls, so sign-out can be asserted on. */
const sessionEnds: { method?: string; authorization: string | null }[] = []
/** x-atlas-client sent with each sign-in code request. */
const codeRequestClients: (string | null)[] = []
const readySession = () => json({ token: TOKEN, user: USER })
const MFA_EMAIL = 'mfa@example.com'
const MFA_TOKEN = 'challenge-token'
const mfaRequired = () =>
  json(
    {
      error: {
        code: 'mfa_required',
        message: 'Enter the code from your authenticator app.',
        details: { mfaToken: MFA_TOKEN },
      },
    },
    401,
  )
const pendingSession = () =>
  json({ error: { code: 'authorization_pending', message: 'not yet' } }, 409)

before(async () => {
  mock.module('electron', {
    namedExports: {
      app: { getVersion: () => '0.0.0-test' },
      shell: {
        openExternal: async (url: string) => {
          openedUrls.push(url)
        },
      },
    },
  })

  mock.module('node:fs/promises', {
    defaultExport: {
      // The files as written, so a sign-out reads back the sign-in it removes.
      readFile: async (at: string) => {
        const data = files.get(at)

        if (data === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })

        return data
      },
      mkdir: async () => {
        if (mkdirError) throw mkdirError
      },
      writeFile: async (at: string, data: string) => {
        files.set(at, data)
        configWrites.push(data)
      },
      chmod: async () => {},
      rename: async (from: string, to: string) => {
        const data = files.get(from)

        if (data !== undefined) files.set(to, data)
        files.delete(from)
      },
      rm: async (at: string) => {
        files.delete(at)
      },
      stat: async () => ({ mtimeMs: 0 }),
    },
  })

  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const url = String(input instanceof Request ? input.url : input)

    // Loopback requests are real — that listener is the thing under test.
    if (url.includes('127.0.0.1') || url.includes('localhost:')) return realFetch(input, init)

    if (url.includes('/auth/social/login')) return chooserProbe()

    if (url.endsWith('/auth/native/session')) {
      if (!nativeSupported)
        return json({ error: { code: 'route_not_found', message: 'nope' } }, 404)
      registrations.push(JSON.parse(String(init?.body)) as Registration)

      return json({ handle: HANDLE, expiresInSec: 600 }, 201)
    }

    if (url.endsWith('/auth/native/session/redeem')) {
      redeemCalls += 1
      redeemBodies.push(JSON.parse(String(init?.body)) as (typeof redeemBodies)[number])
      // Keep replaying the last entry once the queue is down to one.
      const next = redeemQueue.length > 1 ? redeemQueue.shift()! : redeemQueue[0]

      return next ? next() : pendingSession()
    }

    if (url.includes('/auth/me')) return meHandler()

    if (url.endsWith('/auth/email/request-code')) {
      codeRequestClients.push(new Headers(init?.headers).get('x-atlas-client'))

      return json({ ok: true })
    }

    if (url.endsWith('/auth/email/verify-code')) {
      const { email } = JSON.parse(String(init?.body)) as { email: string }

      return email === MFA_EMAIL ? mfaRequired() : json({ token: TOKEN, user: USER })
    }

    if (url.endsWith('/auth/mfa/verify')) {
      const body = JSON.parse(String(init?.body)) as { mfaToken: string; code: string }

      return body.mfaToken === MFA_TOKEN && body.code === '123456'
        ? json({ token: TOKEN, user: USER })
        : json({ error: { code: 'invalid_mfa_code', message: 'That code is not valid' } }, 401)
    }

    if (url.endsWith('/auth/sessions/current')) {
      sessionEnds.push({
        method: init?.method,
        authorization: new Headers(init?.headers).get('authorization'),
      })

      return new Response(null, { status: 204 })
    }

    throw new Error(`unexpected fetch: ${url}`)
  }) as typeof fetch

  auth = await import('./auth.ts')
})

beforeEach(() => {
  openedUrls.length = 0
  configWrites.length = 0
  files.clear()
  registrations = []
  nativeSupported = true
  chooserProbe = () =>
    new Response('provider chooser', {
      headers: { 'X-Nuphos-Social-Login': '1', 'X-Nuphos-Social-Providers': 'google,apple' },
    })
  redeemQueue = [readySession]
  redeemCalls = 0
  redeemBodies = []
  meHandler = async () => json(USER)
  mkdirError = null
})

after(() => {
  globalThis.fetch = realFetch
  auth.cancelPendingLogin()
})

async function waitForBrowser(): Promise<URL> {
  const deadline = Date.now() + 5_000

  while (openedUrls.length === 0) {
    if (Date.now() > deadline) throw new Error('login() never opened a browser URL')
    await new Promise((r) => setTimeout(r, 5))
  }

  return new URL(openedUrls[0]!)
}

/** Plays the browser: hits the loopback listener the way the landing page would. */
async function hitCallback(port: string, query: Record<string, string>) {
  const url = new URL(`http://127.0.0.1:${port}/callback`)

  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)

  return realFetch(url.toString())
}

const registeredPort = () => new URL(registrations[0]!.redirectUri).port

const lastConfig = () =>
  yaml.load(configWrites[configWrites.length - 1]!) as { token?: string; userInfo?: UserInfo }

// ── Native flow ──────────────────────────────────────────────────────────────

test('native: one browser hop to the chosen provider, with the target registered up front', async () => {
  const loginPromise = auth.login('google')

  loginPromise.catch(() => {})

  const opened = await waitForBrowser()

  assert.equal(opened.pathname, '/auth/social/google/start')
  assert.equal(opened.searchParams.get('handle'), HANDLE)
  assert.equal(opened.searchParams.get('state'), null, 'no caller-supplied state in the URL')

  const reg = registrations[0]

  assert.ok(reg, 'the loopback target must be registered before the browser opens')
  assert.match(reg.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/)
  assert.equal(reg.codeChallengeMethod, 'S256')
  assert.match(reg.codeChallenge, /^[A-Za-z0-9_-]{43}$/)

  await hitCallback(registeredPort(), { state: reg.clientState, code: DELIVERY_CODE })

  assert.deepEqual(await loginPromise, USER)
  assert.equal(lastConfig().token, TOKEN)
})

test('native: Apple opens its own start page with the same handle', async () => {
  const loginPromise = auth.login('apple')

  loginPromise.catch(() => {})

  const opened = await waitForBrowser()

  assert.equal(opened.pathname, '/auth/social/apple/start')
  assert.equal(opened.searchParams.get('handle'), HANDLE)

  await hitCallback(registeredPort(), { state: registrations[0]!.clientState, code: DELIVERY_CODE })

  assert.deepEqual(await loginPromise, USER)
})

test('socialProviders reports what the backend offers, and nothing from older servers', async () => {
  assert.deepEqual(await auth.socialProviders(), [
    { provider: 'google', name: 'Google' },
    { provider: 'apple', name: 'Apple' },
  ])

  chooserProbe = () =>
    new Response('provider chooser', {
      headers: {
        'X-Nuphos-Social-Login': '1',
        'X-Nuphos-Social-Providers': 'oidc,unknown',
        'X-Nuphos-Social-Oidc-Name': 'Logto',
      },
    })
  assert.deepEqual(await auth.socialProviders(), [{ provider: 'oidc', name: 'Logto' }])

  chooserProbe = () =>
    new Response('provider chooser', { headers: { 'X-Nuphos-Social-Login': '1' } })
  assert.deepEqual(await auth.socialProviders(), [])

  chooserProbe = () => new Response('Not found', { status: 404 })
  assert.deepEqual(await auth.socialProviders(), [])
})

test('socialProviders fails when the backend cannot be asked, so the screen can retry', async () => {
  chooserProbe = () => new Response('Bad gateway', { status: 502 })
  await assert.rejects(auth.socialProviders(), /HTTP 502/)

  chooserProbe = () => {
    throw new TypeError('fetch failed')
  }
  await assert.rejects(auth.socialProviders(), /fetch failed/)

  // Not configured is an answer, not a failure.
  chooserProbe = () => new Response('Social sign-in is not configured', { status: 503 })
  assert.deepEqual(await auth.socialProviders(), [])
})

test('Apple fails without opening a browser when the backend does not offer it', async () => {
  chooserProbe = () =>
    new Response('provider chooser', {
      headers: { 'X-Nuphos-Social-Login': '1', 'X-Nuphos-Social-Providers': 'google' },
    })

  await assert.rejects(auth.login('apple'), /does not offer Apple/)
  assert.equal(openedUrls.length, 0)
  assert.equal(registrations.length, 0)
})

test('native: redemption presents the verifier and the delivery code together', async () => {
  const loginPromise = auth.login('google')

  loginPromise.catch(() => {})
  await waitForBrowser()

  await hitCallback(registeredPort(), { state: registrations[0]!.clientState, code: DELIVERY_CODE })
  await loginPromise

  const body = redeemBodies[0]

  assert.ok(body, 'a redemption should have been attempted')
  assert.equal(body.handle, HANDLE)
  assert.equal(body.code, DELIVERY_CODE, 'the code from the loopback redirect must be presented')
  // The verifier for the challenge we registered, never published anywhere.
  assert.equal(
    createHash('sha256').update(body.codeVerifier).digest('base64url'),
    registrations[0]!.codeChallenge,
  )
})

test('native: only a challenge is published, never the verifier', async () => {
  const loginPromise = auth.login('google')

  loginPromise.catch(() => {})
  await waitForBrowser()
  await hitCallback(registeredPort(), { state: registrations[0]!.clientState, code: DELIVERY_CODE })
  await loginPromise

  const reg = registrations[0]!

  // A SHA-256 digest, so observing the registration does not let anyone else
  // redeem the handle.
  assert.equal(
    reg.codeChallenge.length,
    createHash('sha256').update('x').digest('base64url').length,
  )
  assert.equal(openedUrls[0]!.includes(reg.codeChallenge), false, 'no challenge in the browser URL')
  assert.equal(
    openedUrls[0]!.includes(reg.clientState),
    false,
    'no correlation value in the browser URL',
  )
})

test('native: the success page is only rendered once the session is in hand', async () => {
  // Pending first, so the exchange has to be retried after the browser arrives.
  redeemQueue = [pendingSession, readySession]

  const loginPromise = auth.login('google')

  loginPromise.catch(() => {})
  await waitForBrowser()

  const res = await hitCallback(registeredPort(), {
    state: registrations[0]!.clientState,
    code: DELIVERY_CODE,
  })

  assert.equal(res.status, 200)
  assert.match(await res.text(), /You&#39;re logged in|You're logged in/)

  assert.deepEqual(await loginPromise, USER)
})

test('native: nothing is redeemed until the browser reaches this machine', async () => {
  // The security property, from the client side. The handle and the verifier
  // are not enough on their own: whoever registered the flow holds both, and on
  // a lured sign-in that is the attacker. Only the loopback redirect proves the
  // browser that authenticated was running here, so the exchange must not even
  // be attempted before it arrives.
  const loginPromise = auth.login('google')

  loginPromise.catch(() => {})
  await waitForBrowser()

  await new Promise((r) => setTimeout(r, 300))
  assert.equal(redeemCalls, 0, 'must not try to redeem before the loopback redirect arrives')
  assert.equal(configWrites.length, 0, 'no session may be stored without it')

  // And it does proceed the moment the redirect lands.
  await hitCallback(registeredPort(), { state: registrations[0]!.clientState, code: DELIVERY_CODE })
  assert.deepEqual(await loginPromise, USER)
})

test('native: a callback carrying no delivery code fails rather than hanging', async () => {
  const loginPromise = auth.login('google')

  loginPromise.catch(() => {})
  await waitForBrowser()

  // What a landing page that dropped the code would send.
  const res = await hitCallback(registeredPort(), { state: registrations[0]!.clientState })

  assert.equal(res.status, 400)

  await assert.rejects(loginPromise)
  assert.equal(redeemCalls, 0)
  assert.equal(configWrites.length, 0)
})

test('native: a sign-in finishing after the endpoint moved stores and uses nothing', async () => {
  const { authSession } = await import('./auth-session.ts')
  const started = authSession.context().api
  const seen: { api: string; token: string | null }[] = []
  const stop = authSession.subscribe((next) => seen.push({ api: next.api, token: next.token }))
  const redeemedAt: string[] = []

  // The endpoint field is changed and submitted while the redeem is out.
  redeemQueue = [
    () => {
      authSession.moveTo('https://nuphos.example.com')

      return readySession()
    },
  ]
  const loginPromise = auth.login('google')

  loginPromise.catch(() => {})
  await waitForBrowser()
  redeemedAt.push(new URL(openedUrls[0]!).origin)
  await hitCallback(registeredPort(), { state: registrations[0]!.clientState, code: DELIVERY_CODE })

  try {
    await assert.rejects(loginPromise, /another backend/u)
    assert.equal(configWrites.length, 0)
    assert.ok(!seen.some((c) => c.token === TOKEN), JSON.stringify(seen))
    assert.equal(redeemedAt[0], new URL(started).origin)
  } finally {
    stop()
    authSession.moveTo(started)
  }
})

test('native: a rejected redemption fails the sign-in and stores nothing', async () => {
  redeemQueue = [
    () =>
      json(
        { error: { code: 'invalid_handle', message: 'This sign-in request is no longer valid' } },
        400,
      ),
  ]

  const loginPromise = auth.login('google')

  loginPromise.catch(() => {})
  await waitForBrowser()
  await hitCallback(registeredPort(), { state: registrations[0]!.clientState, code: DELIVERY_CODE })

  await assert.rejects(loginPromise, /no longer valid/)
  assert.equal(configWrites.length, 0)
})

const EACCES = () =>
  Object.assign(new Error("EACCES: permission denied, mkdir '/Users/u/.config/nuphos'"), {
    code: 'EACCES',
  })
const UNSAVED = /Nuphos couldn.t save your sign-in to \S+: permission denied\./

test('native: a sign-in that cannot be saved says why, in the browser and the app', async () => {
  mkdirError = EACCES()

  const loginPromise = auth.login('google')

  loginPromise.catch(() => {})
  await waitForBrowser()
  const res = await hitCallback(registeredPort(), {
    state: registrations[0]!.clientState,
    code: DELIVERY_CODE,
  })

  assert.equal(res.status, 500)
  assert.match((await res.text()).replaceAll('&#39;', "'"), UNSAVED)
  // Coded, so the app's toast shows the message rather than a network fallback.
  await assert.rejects(loginPromise, (e: Error) => {
    assert.match(e.message, /__ATLAS_API_ERROR__.*"code":"sign_in_not_saved"/)
    assert.match(e.message, UNSAVED)

    return true
  })
})

test('an email-code sign-in that cannot be saved says why', async () => {
  mkdirError = EACCES()

  await assert.rejects(auth.verifyEmailCode('dev@example.com', '123456'), UNSAVED)
})

test('a sign-in that fails to save for another reason keeps its own error', async () => {
  mkdirError = Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })

  await assert.rejects(auth.verifyEmailCode('dev@example.com', '123456'), (e: Error) => {
    assert.equal(e.message, 'ENOSPC: no space left on device')

    return true
  })
})

test('two-factor: a sign-in that needs a code keeps its challenge and stores nothing', async () => {
  await assert.rejects(auth.verifyEmailCode(MFA_EMAIL, '123456'), (e: Error) => {
    assert.match(e.message, /"code":"mfa_required"/)
    assert.match(e.message, /"mfaToken":"challenge-token"/)

    return true
  })
  assert.equal(configWrites.length, 0)

  await assert.rejects(auth.verifyMfa(MFA_TOKEN, '000000'), /"code":"invalid_mfa_code"/)
  assert.equal(configWrites.length, 0)

  assert.deepEqual(await auth.verifyMfa(MFA_TOKEN, '123456'), USER)
  assert.equal(lastConfig().token, TOKEN)
})

test('native: a sign-in that needs a code sends the browser back to the app', async () => {
  redeemQueue = [mfaRequired]

  const loginPromise = auth.login('google')

  loginPromise.catch(() => {})
  await waitForBrowser()
  const res = await hitCallback(registeredPort(), {
    state: registrations[0]!.clientState,
    code: DELIVERY_CODE,
  })

  assert.equal(res.status, 200)
  assert.match(await res.text(), /authenticator app/)
  await assert.rejects(loginPromise, /"code":"mfa_required"/)
  assert.equal(configWrites.length, 0)
})

test('native: an error reported by the browser fails fast', async () => {
  redeemQueue = [pendingSession]

  const loginPromise = auth.login('google')

  loginPromise.catch(() => {})
  await waitForBrowser()

  const res = await hitCallback(registeredPort(), {
    state: registrations[0]!.clientState,
    error: 'Google email is not verified',
  })

  assert.equal(res.status, 400)

  await assert.rejects(loginPromise, /not verified/)
  assert.equal(configWrites.length, 0)
})

test('native: a backend failure delivered as an error code stops the wait', async () => {
  // The F1 case: the landing page's sign-in call never returned, so it resolved
  // the handle to this listener and sent the failure here instead. Without the
  // delivery the app would sit on the listener until the five-minute timeout.
  redeemQueue = [pendingSession]

  const loginPromise = auth.login('google')

  loginPromise.catch(() => {})
  await waitForBrowser()

  const res = await hitCallback(registeredPort(), {
    state: registrations[0]!.clientState,
    error: 'server_error',
    error_description: 'Nuphos could not be reached. Please try again.',
  })

  assert.equal(res.status, 400)
  const page = await res.text()

  assert.match(page, /Sign-in failed/)
  assert.match(page, /could not be reached/)
  await assert.rejects(loginPromise, /could not be reached/)
  assert.equal(redeemCalls, 0, 'nothing to redeem — the exchange never completed')
  assert.equal(configWrites.length, 0)
})

test('native: a bare error code still produces readable copy', async () => {
  const loginPromise = auth.login('google')

  loginPromise.catch(() => {})
  await waitForBrowser()

  const res = await hitCallback(registeredPort(), {
    state: registrations[0]!.clientState,
    error: 'temporarily_unavailable',
  })

  assert.match(await res.text(), /took too long to answer/)
  await assert.rejects(loginPromise, /took too long to answer/)
})

test('native: a failure page never echoes markup back into the browser', async () => {
  // The listener answers anything on this machine, so the delivered text is
  // untrusted input to a page we render.
  const loginPromise = auth.login('google')

  loginPromise.catch(() => {})
  await waitForBrowser()

  const res = await hitCallback(registeredPort(), {
    state: registrations[0]!.clientState,
    error: 'server_error',
    error_description: '<img src=x onerror="alert(1)">',
  })

  const page = await res.text()

  assert.equal(page.includes('<img src=x'), false)
  assert.match(page, /&lt;img src=x/)
  await assert.rejects(loginPromise)
})

test('native: a callback with the wrong state is ignored', async () => {
  const loginPromise = auth.login('google')

  loginPromise.catch(() => {})
  await waitForBrowser()

  const forged = await hitCallback(registeredPort(), { state: 'forged-state', error: 'go away' })

  assert.equal(forged.status, 400)
  assert.equal(await forged.text(), 'invalid request')

  // The forged error must not have derailed the real sign-in.
  await hitCallback(registeredPort(), { state: registrations[0]!.clientState, code: DELIVERY_CODE })
  assert.deepEqual(await loginPromise, USER)
})

// ── Servers without social sign-in ───────────────────────────────────────────

test('Google fails without opening a browser when the backend does not offer it', async () => {
  // A self-hosted server without Google must not send anyone to another server's sign-in.
  chooserProbe = () =>
    new Response('provider chooser', { headers: { 'X-Nuphos-Social-Login': '1' } })

  await assert.rejects(auth.login('google'), /does not offer Google/)
  assert.equal(openedUrls.length, 0)
  assert.equal(registrations.length, 0)
})

test('a backend without the chooser endpoint opens no browser', async () => {
  chooserProbe = () => new Response('Not found', { status: 404 })

  await assert.rejects(auth.login('google'), /does not offer Google/)
  assert.equal(openedUrls.length, 0)
})

test('a backend that redirects the chooser probe opens no browser', async () => {
  // A redirect without the chooser's support header is not evidence the endpoint exists.
  chooserProbe = () =>
    new Response(null, {
      status: 301,
      headers: { location: 'https://api.nuphos.ai/auth/social/login' },
    })

  await assert.rejects(auth.login('google'), /does not offer Google/)
  assert.equal(openedUrls.length, 0)
})

test('a backend without the native endpoint fails without opening a browser', async () => {
  nativeSupported = false

  await assert.rejects(auth.login('google'), /nope/)
  assert.equal(openedUrls.length, 0)
})

test('the probe never spends the real handle', async () => {
  // It runs before registration, so it has none to spend — and the handle that
  // does get registered is the one the browser is sent with.
  const loginPromise = auth.login('google')

  loginPromise.catch(() => undefined)
  const opened = await waitForBrowser()

  assert.equal(registrations.length, 1)
  assert.equal(opened.searchParams.get('handle'), HANDLE)

  await hitCallback(registeredPort(), { state: registrations[0]!.clientState, code: DELIVERY_CODE })
  await loginPromise
})

test('signing out ends the session on the server', async () => {
  const loginPromise = auth.login('google')

  await waitForBrowser()
  await hitCallback(registeredPort(), { state: registrations[0]!.clientState, code: DELIVERY_CODE })
  await loginPromise
  sessionEnds.length = 0

  await auth.logout()

  assert.deepEqual(sessionEnds, [{ method: 'DELETE', authorization: `Bearer ${TOKEN}` }])
  assert.deepEqual(lastConfig(), {})
})

test('asking for a sign-in code names the app, so the email can say so', async () => {
  codeRequestClients.length = 0
  await auth.requestEmailCode('dev@example.com')

  assert.deepEqual(codeRequestClients, ['nuphos-desktop/0.0.0-test'])
})
