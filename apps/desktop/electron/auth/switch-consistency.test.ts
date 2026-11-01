import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import yaml from 'js-yaml'

import { AuthSession } from '../auth-session.ts'

import { configFile } from './config.ts'
import { status } from './me.ts'

import type { MeProbe, UserInfo } from '../auth-status.ts'

// A token must only ever be paired with the backend that issued it: in the
// session, in desktop.yaml, and after a restart.

const CLOUD = 'https://api.nuphos.ai'
const SELF = 'https://nuphos.example.com'
const ALICE: UserInfo = { id: 'alice', name: 'Alice', email: 'a@example.com', username: 'alice' }
const BOB: UserInfo = { id: 'bob', name: 'Bob', email: 'b@example.com', username: 'bob' }

async function harness({ failKeep = false } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nuphos-switch-'))
  const file = path.join(dir, 'desktop.yaml')
  const session = new AuthSession(CLOUD)
  const kept: string[] = []
  const config = configFile({
    path: file,
    store: { get: async () => null, set: async () => {}, delete: async () => {} },
    secure: () => false,
    apiUrl: () => session.context().api,
    onAccount: (api, token, userId) => session.use(api, token, userId),
    keepBackend: (api) => {
      if (failKeep) throw new Error('EACCES: cli.api-url')
      kept.push(api)
    },
  })

  // Alice on Nuphos Cloud, waiting; Bob on a self-hosted backend, active.
  await config.write({ token: 'tok-alice', userInfo: ALICE })
  session.use(SELF, null, null)
  await config.park(CLOUD)
  await config.write({ token: 'tok-bob', userInfo: BOB })
  kept.length = 0
  const onDisk = async () => yaml.load(await fs.readFile(file, 'utf8')) as Record<string, unknown>

  return { dir, file, session, config, kept, onDisk }
}

const pair = (s: AuthSession) => ({ api: s.context().api, token: s.context().token })

test('a status check still out when the account switches commits nothing for the old one', async () => {
  const h = await harness()
  let release!: (probe: MeProbe) => void
  const probes: string[] = []
  const probe = (token: string) => {
    probes.push(token)

    // The first check (Bob's) waits; the one after the switch answers at once.
    return probes.length === 1
      ? new Promise<MeProbe>((resolve) => {
          release = resolve
        })
      : Promise.resolve<MeProbe>({ ok: true, user: ALICE })
  }
  const deps = { readConfig: h.config.read, commitIf: h.config.commitIf, probe, session: h.session }
  const checking = status(deps)

  while (probes.length === 0) await new Promise(setImmediate)
  await h.config.switchTo(`alice@${CLOUD}`)
  release({ ok: true, user: { ...BOB, name: 'Robert' } })
  const result = await checking

  assert.equal(result.loggedIn && result.user.id, 'alice', 'the account now current is checked')
  assert.deepEqual(probes, ['tok-bob', 'tok-alice'])
  assert.deepEqual(pair(h.session), { api: CLOUD, token: 'tok-alice' })
  assert.equal((await h.config.read()).token, 'tok-alice')
  assert.deepEqual(await h.config.list(), [
    { key: `alice@${CLOUD}`, api: CLOUD, userInfo: ALICE, active: true },
    // Bob is still Bob, on his own backend, and the stale answer did not rename him.
    { key: `bob@${SELF}`, api: SELF, userInfo: BOB, active: false },
  ])
})

test('a sign-in is never saved as another backend’s', async () => {
  const h = await harness()

  await assert.rejects(
    h.config.write({ token: 'tok-alice', api: CLOUD, userInfo: ALICE }),
    /belongs to another backend/u,
  )
  assert.deepEqual(pair(h.session), { api: SELF, token: 'tok-bob' })
})

test('a switch whose backend cannot be saved changes nothing', async () => {
  const h = await harness({ failKeep: true })
  const before = await h.onDisk()

  await assert.rejects(h.config.switchTo(`alice@${CLOUD}`), /EACCES/u)
  assert.deepEqual(await h.onDisk(), before)
  assert.deepEqual(pair(h.session), { api: SELF, token: 'tok-bob' })
})

test('a switch whose account file cannot be written puts the backend back', async () => {
  const h = await harness()

  await fs.chmod(h.file, 0o400)
  await assert.rejects(h.config.switchTo(`alice@${CLOUD}`))
  assert.deepEqual(h.kept, [CLOUD, SELF])
  assert.deepEqual(pair(h.session), { api: SELF, token: 'tok-bob' })
  await fs.chmod(h.file, 0o600)
})

test('after a restart between the two writes, the stored account is not used on the wrong backend', async () => {
  const h = await harness()
  // As if the app stopped after saving Alice's backend but before her file:
  // a new process on Nuphos Cloud finds Bob, whose token is the self-hosted one's.
  const restarted = new AuthSession(CLOUD)
  const config = configFile({
    path: h.file,
    store: { get: async () => null, set: async () => {}, delete: async () => {} },
    secure: () => false,
    apiUrl: () => restarted.context().api,
    onAccount: (api, token, userId) => restarted.use(api, token, userId),
    keepBackend: () => {},
  })

  assert.equal((await config.read()).token, undefined, 'signed out, not Bob on Cloud')
  assert.deepEqual(
    (await config.list()).map((a) => [a.key, a.active]),
    [
      [`alice@${CLOUD}`, false],
      [`bob@${SELF}`, false],
    ],
  )
  // Still signed in where it was issued: switching back finds it.
  await config.switchTo(`bob@${SELF}`)
  assert.deepEqual(pair(restarted), { api: SELF, token: 'tok-bob' })
})
