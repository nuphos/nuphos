import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

const calls: string[][] = []
let stored = 2
// What `security` answers once nothing is left: errSecItemNotFound, exit 44.
let failure: () => Error = () =>
  Object.assign(new Error('The specified item could not be found'), { code: 44 })

mock.module('node:child_process', {
  namedExports: {
    execFile: (
      file: string,
      args: string[],
      _options: unknown,
      callback: (error: Error | null) => void,
    ) => {
      assert.equal(file, '/usr/bin/security')
      calls.push(args)
      stored -= 1
      callback(stored >= 0 ? null : failure())
    },
  },
})
const { claudeKeychainService, deleteClaudeKeychainEntry } = await import('./claude-keychain.ts')

test('removing an added agent deletes its entries under any account, then stops', async () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')

  Object.defineProperty(process, 'platform', { value: 'darwin' })
  try {
    const env = { CLAUDE_SECURESTORAGE_CONFIG_DIR: '/instances/a/claude-home' }

    await deleteClaudeKeychainEntry(env)
    // A sign-in that once ran without USER stored its entry under "unknown": the
    // service alone selects it, so no account is named.
    const expected = ['delete-generic-password', '-s', claudeKeychainService(env)]

    assert.deepEqual(calls, [expected, expected, expected])
  } finally {
    if (platform) Object.defineProperty(process, 'platform', platform)
  }
})

test('a deletion that fails for another reason fails, instead of reporting the entry gone', async () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')

  Object.defineProperty(process, 'platform', { value: 'darwin' })
  try {
    // `security` could not run at all, so the entry may still be there.
    stored = 0
    failure = () => Object.assign(new Error('spawn /usr/bin/security ENOENT'), { code: 'ENOENT' })
    await assert.rejects(
      deleteClaudeKeychainEntry({ CLAUDE_SECURESTORAGE_CONFIG_DIR: '/instances/b/claude-home' }),
      /Keychain/u,
    )
  } finally {
    if (platform) Object.defineProperty(process, 'platform', platform)
  }
})
