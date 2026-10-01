import assert from 'node:assert/strict'
import test from 'node:test'

import { localExecShellFor } from './localExecShell.ts'

const hasBash = (path: string) => path === '/bin/bash'
const noBash = () => false

test('POSIX picks bash when present, /bin/sh otherwise', () => {
  assert.deepEqual(localExecShellFor('darwin', hasBash), ['/bin/bash', '-c'])
  assert.deepEqual(localExecShellFor('linux', noBash), ['/bin/sh', '-c'])
})

test('Windows still runs through cmd.exe', () => {
  assert.deepEqual(localExecShellFor('win32', noBash), ['cmd.exe', '/c'])
})

// Regression: local_exec used to run `$SHELL -lc`, so a fish login shell hit
// "Missing end to balance this for loop" (exit 127) on every bash-syntax
// command the agent wrote. The shell must never depend on the user's choice.
test('never defers to the user login shell, and never uses a login flag', () => {
  for (const platform of ['darwin', 'linux'] as const) {
    for (const exists of [hasBash, noBash]) {
      const [shell, flag] = localExecShellFor(platform, exists)

      assert.match(shell, /^\/bin\/(bash|sh)$/)
      assert.equal(flag, '-c')
      assert.doesNotMatch(shell, /fish|zsh/)
    }
  }
})
