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

test('a rejected token clears the session and notifies authenticated transport owners', async () => {
  const h = harness()
  const sessions: (string | null)[] = []

  h.session.subscribe((token) => sessions.push(token))
  await status(h.deps)
  h.setProbe({ ok: false, transient: false })
  assert.deepEqual(await status(h.deps), { loggedIn: false })
  assert.equal(h.session.current(), null)
  assert.equal(h.config().token, undefined)
  assert.equal(sessions.at(-1), null)
  assert.ok(sessions.includes('tok-1'))
})

test('a transient probe failure with a cached user keeps the session', async () => {
  const h = harness()

  await status(h.deps)
  h.setProbe({ ok: false, transient: true })
  await status(h.deps)

  assert.equal(h.session.current(), 'tok-1')
  assert.equal(h.config().token, 'tok-1')
})

test('a transient probe failure with no cached identity leaves the session unauthenticated', async () => {
  const h = harness()

  await status(h.deps)
  h.setProbe({ ok: false, transient: true })
  await h.deps.writeConfig({ token: 'tok-1' })
  await status(h.deps)

  assert.equal(h.session.current(), null)
  assert.equal(h.config().token, 'tok-1', 'an unconfirmed token is kept for the next launch')
})
