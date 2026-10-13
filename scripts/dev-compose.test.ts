import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseStackCommand, stackEnvText } from './dev-compose.ts'

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

test('stack secrets keep a running stack S3 keys, else the main checkout, else fresh ones', () => {
  const example = 'NUPHOS_JWT_SECRET=\nS3_ACCESS_KEY=nuphos-local\nS3_SECRET_KEY=\n'
  const existing = 'NUPHOS_JWT_SECRET=jwt\nS3_ACCESS_KEY=nuphos-local\nS3_SECRET_KEY=old\n'
  const running = { access: 'nuphos-local', secret: 'live' }

  assert.equal(stackEnvText(example, existing, null), existing)
  assert.equal(
    stackEnvText(example, existing, running),
    'NUPHOS_JWT_SECRET=jwt\nS3_ACCESS_KEY=nuphos-local\nS3_SECRET_KEY=live\n',
  )
  assert.match(
    stackEnvText(example, null, null),
    /^NUPHOS_JWT_SECRET=[\da-f]{64}\nS3_ACCESS_KEY=nuphos-local\nS3_SECRET_KEY=[\da-f]{64}\n$/,
  )
})
