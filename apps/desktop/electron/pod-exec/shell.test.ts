import assert from 'node:assert/strict'
import test from 'node:test'

import { NO_SUPPORTED_SHELL_MESSAGE, resolvePodShell } from './shell.ts'

test('selects the first shell that the container can execute', async () => {
  const attempted: string[] = []
  const shell = await resolvePodShell(async (command) => {
    attempted.push(command.join(' '))

    return command[0] === '/bin/ash'
  })

  assert.deepEqual(shell, ['/bin/ash'])
  assert.deepEqual(attempted, ['/bin/bash', '/bin/sh', '/bin/ash'])
})

test('returns no shell after trying every supported candidate', async () => {
  let attempts = 0
  const shell = await resolvePodShell(async () => {
    attempts += 1

    return false
  })

  assert.equal(shell, null)
  assert.ok(attempts > 1)
  assert.match(NO_SUPPORTED_SHELL_MESSAGE, /does not include a supported shell/)
})
