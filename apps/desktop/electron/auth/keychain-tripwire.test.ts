import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { mock, test } from 'node:test'

import yaml from 'js-yaml'

// The real sign-in wiring under plain Node, against a file the packaged app
// wrote: reaching @napi-rs/keyring here is what made macOS ask for the login
// keychain password whenever the suite ran in a signed-in user's shell.
test('plain Node never reaches the keychain, even beside a keychain sign-in', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nuphos-tripwire-'))
  const reached: string[] = []
  const trip = (op: string) => () => {
    reached.push(op)
    throw new Error(`test reached @napi-rs/keyring ${op}`)
  }

  mock.module('@napi-rs/keyring', {
    namedExports: {
      AsyncEntry: class {
        getPassword = trip('getPassword')
        setPassword = trip('setPassword')
        deletePassword = trip('deletePassword')
      },
    },
  })
  process.env.NUPHOS_CLI_CONFIG = path.join(dir, 'cli.yaml')
  await fs.writeFile(
    path.join(dir, 'desktop.yaml'),
    yaml.dump({ keychainAccount: 'u1@https://api.nuphos.ai', user: 'bruce@example.com' }),
  )

  const { keychainStore } = await import('./token-store.ts')
  const { readConfig, requestContext, writeConfig } = await import('./config.ts')

  assert.equal((await readConfig()).token, undefined)
  assert.equal((await requestContext()).token, null)
  await writeConfig({ token: 'tok-1' })
  await writeConfig({})
  await assert.rejects(keychainStore.get('u1@https://api.nuphos.ai'))
  assert.deepEqual(reached, [])
})
