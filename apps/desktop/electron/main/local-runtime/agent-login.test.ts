import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'

import { LocalAgentLogin, claudeLoginUrl } from './agent-login.ts'

import type { spawn } from 'node:child_process'

function harness(
  connected: () => Promise<boolean> = async () => true,
  provider: 'claude-code' | 'codex' = 'claude-code',
) {
  const children: (EventEmitter & {
    stdout: PassThrough
    stderr: PassThrough
    kill: () => boolean
  })[] = []
  let killed = 0
  const calls: unknown[][] = []
  const login = new LocalAgentLogin({
    provider,
    changed: () => {},
    connected,
    spawn: ((...args: unknown[]) => {
      calls.push(args)
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: () => {
          killed += 1

          return true
        },
      })

      children.push(child)

      return child
    }) as unknown as typeof spawn,
  })

  return { login, children, calls, killed: () => killed }
}

test('authorization links only allow the Claude OAuth page', () => {
  assert.equal(claudeLoginUrl('https://evil.example/oauth/authorize'), undefined)
  assert.equal(claudeLoginUrl('https://claude.ai.evil.example/oauth/authorize'), undefined)
  assert.equal(claudeLoginUrl('https://claude.ai/not-oauth?secret=x'), undefined)
  assert.equal(
    claudeLoginUrl('Open https://claude.ai/oauth/authorize?state=test\n'),
    'https://claude.ai/oauth/authorize?state=test',
  )
})

test('duplicate starts share one process; completion requires a verified login', async () => {
  const { login, children, calls } = harness()
  const env = { CLAUDE_CONFIG_DIR: '/isolated', CLAUDE_SECURESTORAGE_CONFIG_DIR: '/isolated' }

  login.start('/bin/claude', env)
  login.start('/bin/claude', env)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0]?.slice(0, 2), ['/bin/claude', ['auth', 'login', '--claudeai']])
  children[0]?.stdout.write('Open https://claude.ai/oauth/authorize?state=test\n')
  assert.equal(login.state().url, 'https://claude.ai/oauth/authorize?state=test')
  children[0]?.emit('exit', 0)
  assert.equal(login.state().state, 'checking')
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(login.state(), { state: 'connected' })
})

test('cancel ignores late output and exit from the old process, and allows retry', () => {
  const { login, children, killed } = harness()

  login.start('/bin/claude', {})
  login.cancel()
  assert.equal(killed(), 1)
  login.start('/bin/claude', {})
  children[0]?.stdout.write('https://claude.ai/oauth/authorize?state=old\n')
  children[0]?.emit('exit', 0)
  assert.deepEqual(login.state(), { state: 'waiting' })
  login.cancel()
})

test('timeout kills the login and exposes a retryable error without raw CLI output', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { login, children, killed } = harness()

  login.start('/bin/claude', {})
  children[0]?.stderr.write('secret credential contents')
  t.mock.timers.tick(5 * 60_000)
  assert.equal(killed(), 1)
  assert.equal(login.state().state, 'failed')
  assert.doesNotMatch(JSON.stringify(login.state()), /secret/u)
})

test('successful CLI exit is insufficient when verification fails', async () => {
  const { login, children } = harness(async () => false)

  login.start('/bin/claude', {})
  children[0]?.emit('exit', 0)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(login.state().state, 'failed')
})

test('cancelling during verification prevents a late success notification', async () => {
  let finish: ((ready: boolean) => void) | undefined
  const { login, children } = harness(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )

  login.start('/bin/claude', {})
  children[0]?.emit('exit', 0)
  login.cancel()
  finish?.(true)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(login.state().state, 'cancelled')
})

test('a nonzero exit clears the authorization URL and allows another login', () => {
  const { login, children, calls } = harness()

  login.start('/bin/claude', {})
  children[0]?.stdout.write('https://claude.ai/oauth/authorize?state=old\n')
  children[0]?.emit('exit', 1)
  assert.equal(login.state().state, 'failed')
  assert.equal(login.state().url, undefined)
  login.start('/bin/claude', {})
  assert.equal(calls.length, 2)
  login.cancel()
})

test('Codex device login parses fragmented ANSI output and requires verification', async () => {
  const { login, children, calls } = harness(async () => true, 'codex')

  login.start('/bin/codex', { CODEX_HOME: '/owner/.codex' })
  assert.deepEqual(calls[0]?.slice(0, 2), [
    '/bin/codex',
    ['-c', 'cli_auth_credentials_store="file"', 'login', '--device-auth'],
  ])
  children[0]?.stdout.write('Open https://evil.example/\n')
  assert.equal(login.state().url, undefined)
  children[0]?.stdout.write(
    'https://auth.openai.com/codex/device\nEnter this one-time code\n\u001b[32mABCD-',
  )
  assert.equal(login.state().userCode, undefined)
  children[0]?.stdout.write('1234\u001b[0m\n')
  assert.equal(login.state().url, 'https://auth.openai.com/codex/device')
  assert.equal(login.state().userCode, 'ABCD-1234')
  children[0]?.emit('exit', 0)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(login.state(), { state: 'connected' })
})

test('Codex cancellation clears its code and ignores a late successful exit', () => {
  const { login, children, killed } = harness(async () => true, 'codex')

  login.start('/bin/codex', {})
  children[0]?.stdout.write(
    'https://auth.openai.com/codex/device\nEnter this one-time code\nABCD-1234\n',
  )
  login.cancel()
  children[0]?.emit('exit', 0)
  assert.equal(killed(), 1)
  assert.deepEqual(login.state(), { state: 'cancelled' })
  login.start('/bin/codex', {})
  assert.deepEqual(login.state(), { state: 'waiting' })
  login.cancel()
})

test('Codex authentication failures expose only a fixed message and permit retry', () => {
  const { login, children } = harness(async () => true, 'codex')

  login.start('/bin/codex', {})
  children[0]?.stderr.write('refresh_token=private')
  children[0]?.emit('exit', 1)
  assert.equal(login.state().state, 'failed')
  assert.doesNotMatch(JSON.stringify(login.state()), /private/u)
  login.start('/bin/codex', {})
  assert.deepEqual(login.state(), { state: 'waiting' })
  login.cancel()
})
