import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync, symlinkSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { nuphosDesktopClaudeEnv } from './claude-session-env.mjs'

test(
  'macOS preserves the Keychain home while shell tools use their session configuration',
  { skip: process.platform === 'win32' },
  (t) => {
    const root = mkdtempSync(path.join(os.tmpdir(), "nuphos tools ' space-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const isolated = {
      HOME: root,
      USERPROFILE: root,
      GH_CONFIG_DIR: path.join(root, '.config', 'gh'),
      AWS_SHARED_CREDENTIALS_FILE: path.join(root, '.aws', 'credentials'),
      NUPHOS_SESSION_HOME: root,
    }
    const env = nuphosDesktopClaudeEnv(
      isolated,
      { HOME: '/host', USERPROFILE: '/host-profile' },
      'darwin',
    )
    assert.equal(env.HOME, '/host')
    assert.equal(env.USERPROFILE, '/host-profile')
    assert.equal(env.GH_CONFIG_DIR, isolated.GH_CONFIG_DIR)
    assert.equal(env.CLAUDE_CODE_SHELL, '/bin/bash')
    assert.equal(env.CLAUDE_CODE_SHELL_SKIP_LOGIN, '1')
    assert.equal(env.CLAUDE_CODE_DISABLE_SHELL_SNAPSHOT, '1')
    const output = execFileSync(
      env.CLAUDE_CODE_SHELL_PREFIX,
      [`printf '%s\\n' "$HOME" "$USERPROFILE" "$GH_CONFIG_DIR" "$AWS_SHARED_CREDENTIALS_FILE"`],
      { env, encoding: 'utf8' },
    )
    assert.deepEqual(output.trim().split('\n'), [
      root,
      root,
      isolated.GH_CONFIG_DIR,
      isolated.AWS_SHARED_CREDENTIALS_FILE,
    ])
    assert.equal(statSync(env.CLAUDE_CODE_SHELL_PREFIX).mode & 0o777, 0o700)
    const other = {
      ...isolated,
      HOME: path.join(root, 'other'),
      USERPROFILE: path.join(root, 'other'),
    }
    const next = nuphosDesktopClaudeEnv(other, { HOME: '/host' }, 'darwin')
    assert.notEqual(next.CLAUDE_CODE_SHELL_PREFIX, env.CLAUDE_CODE_SHELL_PREFIX)
  },
)

test('Linux and Windows retain the existing session environment', () => {
  const env = { HOME: '/isolated', GH_CONFIG_DIR: '/isolated/gh' }
  for (const platform of ['linux', 'win32'])
    assert.equal(nuphosDesktopClaudeEnv(env, { HOME: '/host' }, platform), env)
  assert.deepEqual(nuphosDesktopClaudeEnv({}, { HOME: '/host' }, 'darwin'), {})
})

test(
  'the wrapper cannot overwrite a file through a session symlink',
  { skip: process.platform === 'win32' },
  (t) => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'nuphos-shell-link-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const target = path.join(root, 'protected')
    writeFileSync(target, 'unchanged')
    symlinkSync(target, path.join(root, 'tool-shell.sh'))
    assert.throws(() => nuphosDesktopClaudeEnv({ HOME: root }, { HOME: '/host' }, 'darwin'))
    assert.equal(readFileSync(target, 'utf8'), 'unchanged')
  },
)
