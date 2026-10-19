import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

const calls: string[][] = []
let stored = 2

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
      callback(stored >= 0 ? null : new Error('The specified item could not be found'))
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
