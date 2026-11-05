import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AuthSession } from '../auth-session.ts'

import { status } from './me.ts'

import type { MeProbe, UserInfo } from '../auth-status.ts'
import type { Config } from './config.ts'

const USER: UserInfo = { id: 'u1', name: 'Bruce', email: 'bruce@example.com', username: 'bruce' }

function harness() {
  let config: Config = { token: 'tok-1', userInfo: USER }
  let probe: MeProbe = { ok: true, user: USER }
  const session = new AuthSession()
  const deps = {
    session,
    readConfig: () => Promise.resolve(config),
    writeConfig: (cfg: Config) => {
      config = cfg

      return Promise.resolve()
    },
    commitIf: <T>(
      isCurrent: () => boolean,
      task: (save: (cfg: Config) => Promise<void>) => Promise<T>,
    ): Promise<T | null> =>
      isCurrent()
        ? task((cfg) => {
            config = cfg

            return Promise.resolve()
          })
        : Promise.resolve(null),
    probe: () => Promise.resolve(probe),
  }

  return {
    session,
    deps,
    config: () => config,
    setProbe: (next: MeProbe) => {
      probe = next
    },
  }
}

test('a dead credential clears the session and notifies authenticated transport owners', async () => {
  const h = harness()
  const sessions: (string | null)[] = []

  h.session.subscribe(({ token }) => sessions.push(token))
  await status(h.deps)
  h.setProbe({ ok: false, failure: 'invalid', status: 401 })
  assert.deepEqual(await status(h.deps), { loggedIn: false })
  assert.equal(h.session.current(), null)
  assert.equal(h.config().token, undefined)
  assert.equal(sessions.at(-1), null)
  assert.ok(sessions.includes('tok-1'))
})

test('a refusal without proof signs out this launch and keeps the saved sign-in', async () => {
  const h = harness()

  await status(h.deps)
  h.setProbe({ ok: false, failure: 'refused', status: 403 })

  assert.deepEqual(await status(h.deps), { loggedIn: false })
  assert.equal(h.session.current(), null)
  assert.equal(h.config().token, 'tok-1', 'a refusal says nothing about the credential')
})

test('the sign-in kept after a refusal signs in again on the next check', async () => {
  const h = harness()

  await status(h.deps)
  h.setProbe({ ok: false, failure: 'refused', status: 401 })
  await status(h.deps)

  h.setProbe({ ok: true, user: USER })
  assert.deepEqual(await status(h.deps), { loggedIn: true, user: USER, token: 'tok-1' })
  assert.equal(h.session.current(), 'tok-1', 'no new sign-in was needed')
})

test('a transient probe failure with a cached user keeps the session', async () => {
  const h = harness()

  await status(h.deps)
  h.setProbe({ ok: false, failure: 'transient', status: 503 })
  await status(h.deps)

  assert.equal(h.session.current(), 'tok-1')
  assert.equal(h.config().token, 'tok-1')
})

test('a transient probe failure with no cached identity leaves the session unauthenticated', async () => {
  const h = harness()

  await status(h.deps)
  h.setProbe({ ok: false, failure: 'transient', status: 503 })
  await h.deps.writeConfig({ token: 'tok-1' })
  await status(h.deps)

  assert.equal(h.session.current(), null)
  assert.equal(h.config().token, 'tok-1', 'an unconfirmed token is kept for the next launch')
})

test('a relaunch keeps the signed-in user, so the local runtime keeps running', async () => {
  const h = harness()

  // Every launch starts with an empty session, then checks the stored token.
  await status(h.deps)
  assert.equal(h.session.userId(), 'u1')

  const relaunched = { ...h.deps, session: new AuthSession() }

  await status(relaunched)
  assert.equal(relaunched.session.current(), 'tok-1')
  assert.equal(relaunched.session.userId(), 'u1')
})

test('offline at launch, the cached user still runs the local runtime', async () => {
  const h = harness()

  h.setProbe({ ok: false, failure: 'transient' })
  await status(h.deps)
  assert.equal(h.session.userId(), 'u1')
})

test('a sign-in that cannot be read is an error, not a sign-out', async () => {
  const h = harness()
  let probed = false

  h.deps.readConfig = () => Promise.reject(new Error('denied'))
  h.deps.probe = () => {
    probed = true

    return Promise.resolve({ ok: true, user: USER })
  }

  await assert.rejects(status(h.deps), /denied/)
  assert.equal(probed, false)
  assert.equal(h.session.settled(), false)
  assert.equal(h.config().token, 'tok-1')
})
