import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, mock, test } from 'node:test'

import yaml from 'js-yaml'

// The probe end to end: the real fetch classification, the real sign-in file,
// and the decision of what that failure does to the saved sign-in.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-me-http-'))
const desktopFile = path.join(dir, 'desktop.yaml')
const API = 'https://a.example.test'
const USER = { id: 'u1', name: 'Bruce', email: 'bruce@example.com', username: 'bruce' }

// This app's own sign-in file (cli.yaml → desktop.yaml) and launch endpoint.
process.env.NUPHOS_CLI_CONFIG = path.join(dir, 'cli.yaml')
process.env.NUPHOS_API_URL = API

// What GET /auth/me answers, replaced by each test.
let answer: () => Response = () => new Response(null, { status: 500 })

mock.method(globalThis, 'fetch', () => Promise.resolve(answer()))
after(() => fs.rmSync(dir, { recursive: true, force: true }))

const { status } = await import('./me.ts')
const { authSession } = await import('../auth-session.ts')
const { signOutConfig } = await import('./config.ts')

const json = (body: unknown, code: number) =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { 'content-type': 'application/json' },
  })

const onDisk = () => yaml.load(fs.readFileSync(desktopFile, 'utf8')) as { token?: string }

// Signed in as `token`, with the identity an earlier probe cached. Plain Node
// keeps the token in the file (secureStorageEnabled is false outside the app).
function signedIn(token: string) {
  fs.writeFileSync(
    desktopFile,
    yaml.dump({ api: API, token, user: USER.name, username: USER.username, userInfo: USER }),
  )
  authSession.use(API, token, USER.id)
}

test('a 401 the backend calls unauthorized clears the saved sign-in', async () => {
  signedIn('tok-dead')
  answer = () => json({ error: { code: 'unauthorized', message: 'Invalid or expired token' } }, 401)

  assert.deepEqual(await status(), { loggedIn: false })
  assert.equal(onDisk().token, undefined)
  assert.equal(authSession.current(), null)
})

test('a 401 without the backend code keeps the saved sign-in', async () => {
  signedIn('tok-proxy')
  // A proxy or WAF in front of the backend answers 401 in its own shape.
  answer = () => new Response('<html>Access denied</html>', { status: 401 })

  assert.deepEqual(await status(), { loggedIn: false })
  assert.equal(onDisk().token, 'tok-proxy')
  assert.equal(authSession.current(), null, 'signed out for this launch only')
})

test('a 403 keeps the saved sign-in', async () => {
  signedIn('tok-forbidden')
  answer = () => json({ error: { code: 'forbidden', message: 'You are not a member' } }, 403)

  assert.deepEqual(await status(), { loggedIn: false })
  assert.equal(onDisk().token, 'tok-forbidden')
})

test('a 5xx keeps the session on the cached identity', async () => {
  signedIn('tok-503')
  answer = () => new Response('<html>Service Unavailable</html>', { status: 503 })

  assert.equal((await status()).loggedIn, true)
  assert.equal(onDisk().token, 'tok-503')
  assert.equal(authSession.current(), 'tok-503')
})

test('a transport failure keeps the session', async () => {
  signedIn('tok-offline')
  answer = () => {
    throw new TypeError('fetch failed')
  }

  assert.equal((await status()).loggedIn, true)
  assert.equal(onDisk().token, 'tok-offline')
})

test('a 2xx with an unparseable body keeps the session', async () => {
  signedIn('tok-garbled')
  answer = () => new Response('<html>ok</html>', { status: 200 })

  assert.equal((await status()).loggedIn, true)
  assert.equal(onDisk().token, 'tok-garbled')
})

test('the sign-in kept after a refusal works on the next check', async () => {
  signedIn('tok-recover')
  answer = () => json({ error: { code: 'forbidden' } }, 403)
  await status()

  answer = () => json(USER, 200)
  assert.deepEqual(await status(), { loggedIn: true, user: USER, token: 'tok-recover' })
  assert.equal(authSession.current(), 'tok-recover')
})

test('an explicit sign-out still clears the saved sign-in', async () => {
  signedIn('tok-signout')
  answer = () => json(USER, 200)
  await status()

  await signOutConfig()
  assert.equal(onDisk().token, undefined)
  assert.equal(authSession.current(), null)
})
