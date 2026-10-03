import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'

import { nuphosCodexSessionConfig } from '../image/codex-acp/session-config.mjs'

const binary = process.argv[2]

if (!binary) throw new Error('Usage: node test/codex-shell-env-smoke.mjs <codex binary>')
const base = mkdtempSync(join(tmpdir(), 'nuphos-codex-shell-smoke-'))

mkdirSync(join(base, '.codex'))
const processEnv = {
  PATH: process.env.PATH,
  HOME: base,
  CODEX_HOME: join(base, '.codex'),
  OPENAB_ACP_AUTH_KEY: 'synthetic-transport-key',
  UNSCOPED_SESSION_MARKER: 'synthetic-unscoped-value',
  NUPHOS_TOKEN: 'stale-actor',
  GOMEMLIMIT: '6GiB',
  NODE_OPTIONS: '--max-old-space-size=6144',
  GOFLAGS: '-p=2',
  MAKEFLAGS: '-j2',
  BASH_ENV: '/opt/nuphos-runtime/runtime-guard.sh',
}
const { shell_environment_policy: policy } = nuphosCodexSessionConfig(
  {},
  {
    'ai.nuphos/codex': { env: { NUPHOS_TOKEN: 'scoped-actor', NUPHOS_SESSION_ID: 'shell-smoke' } },
  },
  processEnv,
)
const overrides = [
  '-c',
  `shell_environment_policy.inherit=${JSON.stringify(policy.inherit)}`,
  ...Object.entries(policy.set).flatMap(([key, value]) => [
    '-c',
    `shell_environment_policy.set.${key}=${JSON.stringify(value)}`,
  ]),
]
const child = spawn(resolve(binary), ['app-server', ...overrides], {
  cwd: base,
  env: processEnv,
  stdio: ['pipe', 'pipe', 'pipe'],
})
const exited = once(child, 'exit')
let next = 0
const pending = new Map()
let stderr = ''

child.stderr.on('data', (data) => {
  stderr += data
})
createInterface({ input: child.stdout }).on('line', (line) => {
  const message = JSON.parse(line)
  const resolve = pending.get(message.id)

  if (resolve) {
    pending.delete(message.id)
    resolve(message)
  }
})
const rpc = async (method, params) => {
  const id = ++next
  const response = new Promise((resolve) => pending.set(id, resolve))

  child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  const result = await Promise.race([
    response,
    exited.then(([code]) => {
      throw new Error(`Codex exited (${code}): ${stderr}`)
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout ${method}: ${stderr}`)), 15000).unref(),
    ),
  ])

  assert.equal(result.error, undefined, JSON.stringify(result.error))

  return result.result
}

try {
  await rpc('initialize', { clientInfo: { name: 'nuphos-shell-smoke', version: '1' } })
  const result = await rpc('command/exec', {
    command: [
      '/bin/sh',
      '-c',
      'test -z "${OPENAB_ACP_AUTH_KEY+x}" && test -z "${UNSCOPED_SESSION_MARKER+x}" && test "$NUPHOS_TOKEN" = scoped-actor && test "$GOMEMLIMIT" = 6GiB && test "$NODE_OPTIONS" = --max-old-space-size=6144 && test "$GOFLAGS" = -p=2 && test "$MAKEFLAGS" = -j2 && test "$BASH_ENV" = /opt/nuphos-runtime/runtime-guard.sh && test "$HOME" = "$NUPHOS_SESSION_HOME" && test "$GH_CONFIG_DIR" = "$HOME/.config/gh" && test "$CLOUDSDK_CONFIG" = "$HOME/.config/gcloud" && command -v sh >/dev/null',
    ],
    cwd: base,
    sandboxPolicy: { type: 'dangerFullAccess' },
    timeoutMs: 10000,
  })

  assert.equal(result.exitCode, 0, `Codex shell environment isolation failed: ${result.stderr}`)
  console.log(
    'PASS real Codex App Server shell: no transport key or unscoped env; scoped credentials and CLI environment available',
  )
} finally {
  child.stdin.end()
  child.kill()
  await exited
  rmSync(base, { recursive: true, force: true })
}
