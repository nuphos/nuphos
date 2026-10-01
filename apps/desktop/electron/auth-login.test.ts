import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test, mock, before, beforeEach, after } from 'node:test'

import yaml from 'js-yaml'

import type { UserInfo } from './auth-status.ts'

// Run with: pnpm test
// (node --experimental-strip-types --experimental-test-module-mocks --test ...)
//
// Drives login() end to end over a real loopback HTTP request, with `electron`,
// the config file, and both servers (api.nuphos.ai / nuphos.ai) mocked out.
//
// Both flows are covered because both ship at once: the legacy one stays
// reachable against a deployment without the native endpoints.

const USER: UserInfo = {
  id: '507f1f77bcf86cd799439011',
  name: 'Bruce',
  email: 'bruce@example.com',
  username: 'bruce',
}

const b64url = (value: string) => Buffer.from(value, 'utf8').toString('base64url')
const encodeUser = (user: unknown) => b64url(JSON.stringify(user))
const tokenFor = (sub: string) =>
  `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ aud: 'nuphos', sub }))}.sig`

const TOKEN = tokenFor(USER.id)
const HANDLE = 'h'.repeat(43)
/** What the landing page puts on the loopback redirect after a real sign-in. */
const DELIVERY_CODE = 'd'.repeat(43)

const openedUrls: string[] = []
const configWrites: string[] = []

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
/** How the fake landing page answers GET /api/google/start. */
let landingStart: () => Response = () =>
  new Response(null, {
    status: 302,
    headers: { location: 'https://accounts.google.com/o/oauth2/v2/auth' },
  })
let redeemQueue: (() => Response)[] = []
let redeemCalls = 0
/** Bodies POSTed to /auth/native/session/redeem, so tests can assert on them. */
let redeemBodies: { handle: string; codeVerifier: string; code?: string }[] = []
let meHandler: () => Promise<Response> = () => {
  throw new Error('unexpected /auth/me call')
}

let auth: typeof import('./auth.ts')
const realFetch = globalThis.fetch

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const readySession = () => json({ token: TOKEN, user: USER })
const pendingSession = () =>
  json({ error: { code: 'authorization_pending', message: 'not yet' } }, 409)

before(async () => {
  mock.module('electron', {
    namedExports: {
      shell: {
        openExternal: async (url: string) => {
          openedUrls.push(url)
        },
      },
    },
  })

  mock.module('node:fs/promises', {
    defaultExport: {
      readFile: async () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      },
      mkdir: async () => undefined,
      writeFile: async (_path: string, data: string) => {
        configWrites.push(data)
      },
      chmod: async () => undefined,
    },
  })

  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const url = String(input instanceof Request ? input.url : input)

    // Loopback requests are real — that listener is the thing under test.
    if (url.includes('127.0.0.1') || url.includes('localhost:')) return realFetch(input, init)

    if (url.includes('/api/google/start')) return landingStart()

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

    throw new Error(`unexpected fetch: ${url}`)
  }) as typeof fetch

  auth = await import('./auth.ts')
})

beforeEach(() => {
  openedUrls.length = 0
  configWrites.length = 0
  registrations = []
  nativeSupported = true
  landingStart = () =>
    new Response(null, {
      status: 302,
      headers: { location: 'https://accounts.google.com/o/oauth2/v2/auth' },
    })
  redeemQueue = [readySession]
  redeemCalls = 0
  redeemBodies = []
  meHandler = () => {
    throw new Error('unexpected /auth/me call')
  }
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

const legacyState = (opened: URL) =>
  JSON.parse(Buffer.from(opened.searchParams.get('state')!, 'base64').toString('utf8')) as {
    callbackUrl: string
    clientState: string
  }

const lastConfig = () =>
  yaml.load(configWrites[configWrites.length - 1]!) as { token?: string; userInfo?: UserInfo }

// ── Native flow ──────────────────────────────────────────────────────────────

test('native: one browser hop to Google, with the target registered up front', async () => {
  const loginPromise = auth.login()

  loginPromise.catch(() => undefined)

  const opened = await waitForBrowser()

  assert.equal(opened.pathname, '/api/google/start')
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

test('native: redemption presents the verifier and the delivery code together', async () => {
  const loginPromise = auth.login()

  loginPromise.catch(() => undefined)
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
  const loginPromise = auth.login()

  loginPromise.catch(() => undefined)
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

  const loginPromise = auth.login()

  loginPromise.catch(() => undefined)
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
  const loginPromise = auth.login()

  loginPromise.catch(() => undefined)
  await waitForBrowser()

  await new Promise((r) => setTimeout(r, 300))
  assert.equal(redeemCalls, 0, 'must not try to redeem before the loopback redirect arrives')
  assert.equal(configWrites.length, 0, 'no session may be stored without it')

  // And it does proceed the moment the redirect lands.
  await hitCallback(registeredPort(), { state: registrations[0]!.clientState, code: DELIVERY_CODE })
  assert.deepEqual(await loginPromise, USER)
})

test('native: a callback carrying no delivery code fails rather than hanging', async () => {
  const loginPromise = auth.login()

  loginPromise.catch(() => undefined)
  await waitForBrowser()

  // What a landing page that dropped the code would send.
  const res = await hitCallback(registeredPort(), { state: registrations[0]!.clientState })

  assert.equal(res.status, 400)

  await assert.rejects(loginPromise)
  assert.equal(redeemCalls, 0)
  assert.equal(configWrites.length, 0)
})

test('native: a rejected redemption fails the sign-in and stores nothing', async () => {
  redeemQueue = [
    () =>
      json(
        { error: { code: 'invalid_handle', message: 'This sign-in request is no longer valid' } },
        400,
      ),
  ]

  const loginPromise = auth.login()

  loginPromise.catch(() => undefined)
  await waitForBrowser()
  await hitCallback(registeredPort(), { state: registrations[0]!.clientState, code: DELIVERY_CODE })

  await assert.rejects(loginPromise, /no longer valid/)
  assert.equal(configWrites.length, 0)
})

test('native: an error reported by the browser fails fast', async () => {
  redeemQueue = [pendingSession]

  const loginPromise = auth.login()

  loginPromise.catch(() => undefined)
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

  const loginPromise = auth.login()

  loginPromise.catch(() => undefined)
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
  const loginPromise = auth.login()

  loginPromise.catch(() => undefined)
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
  const loginPromise = auth.login()

  loginPromise.catch(() => undefined)
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
  const loginPromise = auth.login()

  loginPromise.catch(() => undefined)
  await waitForBrowser()

  const forged = await hitCallback(registeredPort(), { state: 'forged-state', error: 'go away' })

  assert.equal(forged.status, 400)
  assert.equal(await forged.text(), 'invalid request')

  // The forged error must not have derailed the real sign-in.
  await hitCallback(registeredPort(), { state: registrations[0]!.clientState, code: DELIVERY_CODE })
  assert.deepEqual(await loginPromise, USER)
})

// ── Falling back to the legacy flow ──────────────────────────────────────────

test('falls back to the legacy flow when the backend has no native endpoint', async () => {
  nativeSupported = false

  const loginPromise = auth.login()

  loginPromise.catch(() => undefined)
  const opened = await waitForBrowser()

  assert.equal(opened.pathname, '/login')

  const state = legacyState(opened)
  const res = await hitCallback(new URL(state.callbackUrl).port, {
    token: TOKEN,
    state: state.clientState,
    user: encodeUser(USER),
  })

  assert.equal(res.status, 200)

  assert.deepEqual(await loginPromise, USER)
  assert.equal(lastConfig().token, TOKEN)
})

test('falls back to the legacy flow when the landing page has no start endpoint', async () => {
  landingStart = () => new Response('Not found', { status: 404 })

  const loginPromise = auth.login()

  loginPromise.catch(() => undefined)
  const opened = await waitForBrowser()

  assert.equal(opened.pathname, '/login')
  assert.equal(redeemCalls, 0, 'must not poll a flow the landing page cannot start')
  assert.equal(registrations.length, 0, 'a legacy fallback must not orphan a registration')

  const state = legacyState(opened)

  await hitCallback(new URL(state.callbackUrl).port, {
    token: TOKEN,
    state: state.clientState,
    user: encodeUser(USER),
  })
  assert.deepEqual(await loginPromise, USER)
})

test('falls back to the legacy flow when the landing page 3xxs everything', async () => {
  // An older landing page that 301s unknown paths — apex to www, http to https
  // — answers the probe with a 3xx while having no /api/google/start at all.
  // Taking that as support selects the native flow against a deployment that
  // cannot run it, and the sign-in then hangs to the five-minute timeout.
  landingStart = () =>
    new Response(null, {
      status: 301,
      headers: { location: 'https://www.nuphos.ai/api/google/start' },
    })

  const loginPromise = auth.login()

  loginPromise.catch(() => undefined)
  const opened = await waitForBrowser()

  assert.equal(opened.pathname, '/login', 'a bare redirect is not evidence the endpoint exists')

  const state = legacyState(opened)

  await hitCallback(new URL(state.callbackUrl).port, {
    token: TOKEN,
    state: state.clientState,
    user: encodeUser(USER),
  })
  assert.deepEqual(await loginPromise, USER)
})

test('native: a redirect chain that reaches Google still counts as support', async () => {
  // The legitimate shape of the same thing: apex 301s to www, and www really
  // does have the endpoint.
  let hops = 0

  landingStart = () => {
    hops += 1

    return hops === 1
      ? new Response(null, {
          status: 301,
          headers: { location: 'https://www.nuphos.ai/api/google/start?handle=x' },
        })
      : new Response(null, {
          status: 302,
          headers: { location: 'https://accounts.google.com/o/oauth2/v2/auth' },
        })
  }

  const loginPromise = auth.login()

  loginPromise.catch(() => undefined)
  const opened = await waitForBrowser()

  assert.equal(opened.pathname, '/api/google/start')

  await hitCallback(registeredPort(), { state: registrations[0]!.clientState, code: DELIVERY_CODE })
  assert.deepEqual(await loginPromise, USER)
})

test('the probe never spends the real handle', async () => {
  // It runs before registration, so it has none to spend — and the handle that
  // does get registered is the one the browser is sent with.
  const loginPromise = auth.login()

  loginPromise.catch(() => undefined)
  const opened = await waitForBrowser()

  assert.equal(registrations.length, 1)
  assert.equal(opened.searchParams.get('handle'), HANDLE)

  await hitCallback(registeredPort(), { state: registrations[0]!.clientState, code: DELIVERY_CODE })
  await loginPromise
})

test('legacy: falls back to /auth/me when no user is forwarded', async () => {
  nativeSupported = false
  let meCalls = 0

  meHandler = async () => {
    meCalls += 1

    return json(USER)
  }

  const loginPromise = auth.login()

  loginPromise.catch(() => undefined)
  const state = legacyState(await waitForBrowser())

  await hitCallback(new URL(state.callbackUrl).port, { token: TOKEN, state: state.clientState })

  assert.deepEqual(await loginPromise, USER)
  assert.equal(meCalls, 1)
})

test('legacy: a failed /auth/me never renders the success page', async () => {
  nativeSupported = false
  meHandler = async () => new Response('nope', { status: 500 })

  const loginPromise = auth.login()

  loginPromise.catch(() => undefined)
  const state = legacyState(await waitForBrowser())

  const res = await hitCallback(new URL(state.callbackUrl).port, {
    token: TOKEN,
    state: state.clientState,
  })

  assert.equal(res.status, 500)
  assert.doesNotMatch(await res.text(), /logged in/i)

  await assert.rejects(loginPromise)
  assert.equal(configWrites.length, 0)
})
