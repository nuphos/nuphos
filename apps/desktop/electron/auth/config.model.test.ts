// Random interleavings of everything that changes the sign-in at once (sign-ins
// on two backends, switches, sign-outs, status probes), checked against the
// invariants the rest of the app relies on:
//
// I1. A token takes effect only while the app points at the backend it was
//     issued by, so no token is ever sent to another backend.
// I2. Once settled, the session is the file's current account, on its backend.
// I3. A probe's write lands only if no other change landed since its read.

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { normalizedApi, sameAccount } from './accounts.ts'
import { configFile } from './config.ts'

import type { UserInfo } from '../auth-status.ts'
import type { TokenStore } from './token-store.ts'

const BACKENDS = ['https://api.nuphos.ai', 'https://nuphos.example.com']
const USERS = ['u1', 'u2', 'u3']

const user = (id: string): UserInfo => ({ id, name: id, email: `${id}@example.com`, username: id })

/** A small seeded generator, so a failing run can be replayed. */
function random(seed: number) {
  let s = seed

  return (n: number) => {
    s = (s * 1103515245 + 12345) % 2147483648

    return s % n
  }
}

async function run(seed: number) {
  const pick = random(seed)
  let api = BACKENDS[0]
  let session: string | null = null
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nuphos-model-'))
  const items = new Map<string, string>()
  // The backend each token was issued by.
  const issuedBy = new Map<string, string>()
  const store: TokenStore = {
    get: async (account) => {
      await new Promise(setImmediate)

      return items.get(account) ?? null
    },
    set: async (account, token) => {
      await new Promise(setImmediate)
      items.set(account, token)
    },
    delete: (account) => {
      items.delete(account)

      return Promise.resolve()
    },
  }
  const config = configFile({
    path: path.join(dir, 'desktop.yaml'),
    store,
    secure: () => pick(2) === 0,
    apiUrl: () => api,
    setApiUrl: (url) => {
      // I1: the outgoing session is gone before the backend changes.
      assert.equal(session, null, `seed ${seed}: moved to ${url} with a session`)
      api = url
    },
    onToken: (token) => {
      if (token) assert.equal(api, issuedBy.get(token), `seed ${seed}: ${token} on ${api}`)
      session = token
    },
  })
  const ops: Promise<unknown>[] = []

  for (let i = 0; i < 24; i++) {
    const op = pick(5)

    if (op <= 1) {
      const backend = BACKENDS[pick(2)]
      const token = `tok-${seed}-${i}`

      issuedBy.set(token, backend)
      ops.push(config.write({ token, userInfo: user(USERS[pick(3)]), apiUrl: `${backend}/` }))
    } else if (op === 2) {
      ops.push(
        config.others().then(async (others) => {
          const target = others[pick(Math.max(others.length, 1))]

          if (target) await config.switchTo(target.key).catch(() => undefined)
        }),
      )
    } else if (op === 3) {
      ops.push(pick(3) === 0 ? config.signOutAll() : config.write({}))
    } else {
      // A status probe that refreshes the account it read, if it still may.
      ops.push(
        config.read().then(async (read) => {
          await new Promise(setImmediate)
          let accepted = false
          const wrote = await config.writeIf(read, (current) => {
            accepted = config.unchangedSince(read) && sameAccount(current, read, api)

            return accepted
          })

          // I3
          assert.equal(wrote, accepted, `seed ${seed}: a probe wrote over a newer change`)
        }),
      )
    }
  }
  await Promise.all(ops)
  await config.settled()
  const current = await config.read()

  // I2
  assert.equal(session, current.token ?? null, `seed ${seed}: session is not the file's`)
  if (current.token) {
    assert.equal(api, normalizedApi(current.apiUrl ?? api), `seed ${seed}: wrong backend`)
    assert.equal(api, issuedBy.get(current.token), `seed ${seed}: token on another backend`)
  }
  await fs.rm(dir, { recursive: true, force: true })
}

test('concurrent sign-ins, switches, sign-outs and probes keep every token on its backend', async () => {
  for (let seed = 1; seed <= 200; seed++) await run(seed)
})
