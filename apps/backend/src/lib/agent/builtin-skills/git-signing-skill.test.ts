/* eslint-disable sonarjs/no-os-command-from-path -- Runs real git and ssh-keygen against a fixture-owned HOME. */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, expect, test } from 'bun:test'

const scripts = join(import.meta.dir, 'skills/git-signing/scripts')
const setup = join(scripts, 'setup-signing.sh')
const alice = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const bob = 'bbbbbbbbbbbbbbbbbbbbbbbb'

let root: string
let globalConfig: string
let env: Record<string, string>

const run = (cmd: string, args: string[], cwd = root) =>
  execFileSync(cmd, args, { cwd, env, encoding: 'utf8', stdio: 'pipe' }).trim()
const fails = (cmd: string, args: string[], cwd = root) => {
  try {
    run(cmd, args, cwd)
  } catch (error) {
    return String((error as { stderr?: string }).stderr)
  }
  throw new Error(`${cmd} ${args.join(' ')} unexpectedly succeeded`)
}
const setupAlice = () => run('bash', [setup, alice, '--name', 'Alice Example', '--email', 'alice@example.invalid'])

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'git-signing-'))
  globalConfig = join(root, '.gitconfig')
  env = {
    PATH: process.env.PATH ?? '',
    HOME: root,
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: '1',
  }
  // A shared config that already names someone, as a previous setup might have left it.
  writeFileSync(globalConfig, '[user]\n\tname = Somebody\n\temail = somebody@example.invalid\n')
  run('git', ['init', '-q', 'repo'])
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

test('signs and verifies commits for the participant who set it up', () => {
  const out = setupAlice()
  expect(out).toContain('ssh-ed25519 ')
  const repo = join(root, 'repo')
  const bin = join(root, '.local/bin/git-as')

  run(bin, [alice, 'commit', '-q', '--allow-empty', '-m', 'signed'], repo)
  expect(run(bin, [alice, 'log', '-1', '--format=%an <%ae> %G?'], repo)).toBe(
    'Alice Example <alice@example.invalid> G',
  )
  expect(statSync(join(root, '.config/nuphos-git-identities', alice, 'signing_ed25519')).mode & 0o777).toBe(0o600)
})

test('leaves no identity in the shared config, so plain git commits fail', () => {
  setupAlice()
  const shared = readFileSync(globalConfig, 'utf8')
  expect(shared).not.toContain('Somebody')
  expect(shared).not.toContain('signingkey')
  expect(fails('git', ['commit', '-q', '--allow-empty', '-m', 'x'], join(root, 'repo'))).toContain(
    'Author identity unknown',
  )
})

test('refuses a participant without an identity', () => {
  setupAlice()
  expect(fails(join(root, '.local/bin/git-as'), [bob, 'status'], join(root, 'repo'))).toContain(
    `no git identity configured for participant ${bob}`,
  )
  expect(fails(join(root, '.local/bin/git-as'), ['../' + alice, 'status'])).toContain('invalid sender id')
})

test('keeps the existing key when run again', () => {
  setupAlice()
  const pub = join(root, '.config/nuphos-git-identities', alice, 'signing_ed25519.pub')
  const first = readFileSync(pub, 'utf8')
  setupAlice()
  expect(readFileSync(pub, 'utf8')).toBe(first)
})

test('rejects values that could escape the generated git config', () => {
  expect(fails('bash', [setup, alice, '--name', 'Eve"\n[core]', '--email', 'e@example.invalid'])).toContain(
    'must not contain quotes',
  )
  expect(fails('bash', [setup, '../x', '--name', 'Eve', '--email', 'e@example.invalid'])).toContain('invalid sender id')
})
