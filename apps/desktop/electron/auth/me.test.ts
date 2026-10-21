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
    readConfig: () => Promise.resolve(config),
    // As the config file does it: only while the file names the account read.
    commit: (read: Config, next: Config | null, token: string | null) => {
      if (config.token !== read.token) return Promise.resolve(false)
      if (next) config = next
      session.set(token)

      return Promise.resolve(true)
    },
    probe: (_token: string): Promise<MeProbe> => Promise.resolve(probe),
  }

  return {
    session,
    deps,
    config: () => config,
    setConfig: (next: Config) => {
      config = next
    },
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
  h.setConfig({ token: 'tok-1' })
  await status(h.deps)

  assert.equal(h.session.current(), null)
  assert.equal(h.config().token, 'tok-1', 'an unconfirmed token is kept for the next launch')
})

test('a probe answering after another account took over checks that account instead', async () => {
  const h = harness()
  const OTHER: UserInfo = { ...USER, id: 'u9', email: 'other@example.com' }
  let switched = false

  h.setProbe({ ok: false, transient: false })
  h.deps.probe = (token: string) => {
    if (!switched) {
      // Another window switches to u9 while u1's probe is out.
      switched = true
      h.setConfig({ token: 'tok-9', userInfo: OTHER })

      return Promise.resolve<MeProbe>({ ok: false, transient: false })
    }

    return Promise.resolve<MeProbe>(
      token === 'tok-9' ? { ok: true, user: OTHER } : { ok: false, transient: false },
    )
  }

  assert.deepEqual(await status(h.deps), { loggedIn: true, token: 'tok-9', user: OTHER })
  assert.equal(h.session.current(), 'tok-9')
  assert.equal(h.config().token, 'tok-9')
})

test('a rejected probe for an account no longer current signs nothing out', async () => {
  const h = harness()
  const OTHER: UserInfo = { ...USER, id: 'u9', email: 'other@example.com' }
  let first = true

  h.deps.probe = (token: string) => {
    if (first) {
      first = false
      // u9 takes over after the probe read u1, before its answer is applied.
      h.setConfig({ token: 'tok-9', userInfo: OTHER })
    }

    return Promise.resolve<MeProbe>(
      token === 'tok-9' ? { ok: true, user: OTHER } : { ok: false, transient: false },
    )
  }

  assert.deepEqual(await status(h.deps), { loggedIn: true, token: 'tok-9', user: OTHER })
  assert.equal(h.config().token, 'tok-9')
  assert.equal(h.session.current(), 'tok-9')
})
