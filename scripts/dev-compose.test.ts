import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseStackCommand } from './dev-compose.ts'

test('stop, ps and logs map to compose subcommands', () => {
  assert.deepEqual(parseStackCommand(['stop']), { kind: 'run', args: ['stop'] })
  assert.deepEqual(parseStackCommand(['ps']), { kind: 'run', args: ['ps'] })
  assert.deepEqual(parseStackCommand(['logs', 'runtime']), {
    kind: 'run',
    args: ['logs', '-f', '--tail', '200', 'runtime'],
  })
})

test('login signs the runtime in interactively', () => {
  assert.deepEqual(parseStackCommand(['login']), {
    kind: 'run',
    args: ['exec', 'runtime', 'claude', 'auth', 'login'],
  })
})

test('reset asks first unless --yes is passed', () => {
  assert.deepEqual(parseStackCommand(['reset']), { kind: 'reset', confirmed: false })
  assert.deepEqual(parseStackCommand(['reset', '--yes']), { kind: 'reset', confirmed: true })
})

test('runtime-password prints the password the runtime generated', () => {
  assert.deepEqual(parseStackCommand(['runtime-password']), {
    kind: 'run',
    args: ['exec', '-T', 'runtime', 'cat', '/home/node/.nuphos-runtime/auth-key'],
  })
})

test('instances lists, and rm names the one to remove', () => {
  assert.deepEqual(parseStackCommand(['instances']), { kind: 'instances', remove: null })
  assert.deepEqual(parseStackCommand(['instances', 'rm', 'pr12']), {
    kind: 'instances',
    remove: 'pr12',
  })
  assert.deepEqual(parseStackCommand(['instances', 'rm']), { kind: 'usage' })
})

test('anything else prints usage', () => {
  assert.deepEqual(parseStackCommand([]), { kind: 'usage' })
  assert.deepEqual(parseStackCommand(['down']), { kind: 'usage' })
  assert.deepEqual(parseStackCommand(['register']), { kind: 'usage' })
})
