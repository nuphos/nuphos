import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { strFromU8, unzipSync } from 'fflate'

import {
  diagnosticsSummary,
  findRuntimeLogs,
  readTail,
  redactLog,
  writeDiagnostics,
} from './diagnostics.ts'

import type { LocalRuntimeState } from './controller-types.ts'

const ESC = String.fromCharCode(27)
const HOME = '/Users/jane'

function scratch(t: test.TestContext): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'diagnostics-'))

  t.after(() => rmSync(dir, { recursive: true, force: true }))

  return dir
}

function write(file: string, content: string) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, content)
}

test('a token between colour codes is still redacted', () => {
  const line = `${ESC}[2m2026-11-20T10:00:00Z${ESC}[0m ${ESC}[32m INFO${ESC}[0m auth ${ESC}[3mtoken${ESC}[0m${ESC}[2m=${ESC}[0mabc123secret done`

  assert.equal(redactLog(line, HOME), '2026-11-20T10:00:00Z  INFO auth token=[redacted] done')
})

test('keys, headers, credentials and emails in log lines are redacted', () => {
  const cases: [string, string][] = [
    ['Authorization: Bearer sk-ant-api03-abcdefghijklmnop', 'Authorization: [redacted]'],
    ['sent Bearer eyJhbGciOi.J9.abc to backend', 'sent Bearer [redacted] to backend'],
    ['GH_TOKEN ghs_ABCdef0123456789xyz', 'GH_TOKEN [redacted_key]'],
    ['pat github_pat_11ABCDEFG0123456789_abcdef', 'pat [redacted_key]'],
    ['key sk-proj-ABCdef0123456789', 'key [redacted_key]'],
    ['cookie=session=abc; path=/', 'cookie=[redacted]; path=/'],
    ['{"api_key":"k-123","model":"o3"}', '{"api_key":"[redacted]","model":"o3"}'],
    [
      'proxy https://bob:hunter2@proxy.example.com:8080',
      'proxy https://[redacted_credentials]@proxy.example.com:8080',
    ],
    ['signed in as jane.doe@example.com', 'signed in as [redacted_email]'],
    ['aws AKIAIOSFODNN7EXAMPLE', 'aws [redacted_aws_access_key]'],
  ]

  for (const [input, expected] of cases) assert.equal(redactLog(input, HOME), expected, input)
})

test('the home directory is shortened to ~ and ordinary detail is kept', () => {
  assert.equal(
    redactLog(`spawn ${HOME}/Library/Nuphos/codex exit=1 session=4f2c pool_max=8`, HOME),
    'spawn ~/Library/Nuphos/codex exit=1 session=4f2c pool_max=8',
  )
})

test('a private key is removed with everything after it', () => {
  assert.equal(
    redactLog('loaded -----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaA\n', HOME),
    'loaded [redacted_private_key]',
  )
})

test('a long log keeps only its end, from the start of a line', async (t) => {
  const file = path.join(scratch(t), 'openab.log')

  write(file, 'first line\nsecond line\nthird line\n')
  assert.equal(await readTail(file, 15), 'third line\n')
  assert.equal(await readTail(file, 1000), 'first line\nsecond line\nthird line\n')
})

test('every agent and instance log is found, and nothing else', async (t) => {
  const dir = scratch(t)
  const own = path.join(dir, 'users', 'u1', 'codex', 'openab.log')
  const instance = path.join(dir, 'instances', 'i1', 'users', 'u1', 'claude-code', 'openab.log')

  write(own, 'a\n')
  write(instance, 'b\n')
  write(path.join(dir, 'users', 'u1', 'codex', 'openab.toml'), 'secret')
  write(path.join(dir, 'users', 'u1', 'workspace', 'nested', 'openab.log'), 'not a runtime log')

  assert.deepEqual((await findRuntimeLogs(dir)).sort(), [instance, own].sort())
  assert.deepEqual(await findRuntimeLogs(path.join(dir, 'missing')), [])
})

test('the summary carries versions and states, never the signed-in account', () => {
  const state: LocalRuntimeState = {
    agents: {
      codex: {
        available: true,
        online: false,
        error: 'login failed for jane@example.com',
        cli: {
          installed: true,
          path: '/opt/codex',
          version: '0.80.0',
          loggedIn: true,
          account: 'jane@example.com',
        },
      },
    } as unknown as LocalRuntimeState['agents'],
    workspace: null,
    userId: 'u1',
  }
  const summary = diagnosticsSummary('1.2.3', null, state)
  const text = JSON.stringify(summary)

  assert.equal(summary.desktop.version, '1.2.3')
  assert.deepEqual(summary.agents.codex, {
    available: true,
    online: false,
    cli: { installed: true, version: '0.80.0', signedIn: true },
    error: 'login failed for [redacted_email]',
  })
  assert.ok(!text.includes('jane'))
  assert.ok(!text.includes('/opt/codex'))
})

test('the saved zip holds the summary and each redacted log', async (t) => {
  const dir = scratch(t)
  const dataDir = path.join(dir, 'local-runtime')
  const zip = path.join(dir, 'out.zip')

  write(
    path.join(dataDir, 'users', 'u1', 'codex', 'openab.log'),
    `${ESC}[32mINFO${ESC}[0m token=abc ${HOME}/x\n`,
  )
  await writeDiagnostics(zip, { dataDir, home: HOME, summary: { desktop: { version: '1.2.3' } } })

  const files = unzipSync(readFileSync(zip))

  assert.deepEqual(Object.keys(files).sort(), ['logs/users/u1/codex/openab.log', 'summary.json'])
  assert.equal(strFromU8(files['logs/users/u1/codex/openab.log']), 'INFO token=[redacted] ~/x\n')
  assert.equal(JSON.parse(strFromU8(files['summary.json'])).desktop.version, '1.2.3')
})
