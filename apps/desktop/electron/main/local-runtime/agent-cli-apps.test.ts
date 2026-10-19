import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { appManagedCli, claudeDesktopClis } from './agent-cli-apps.ts'
import { findAgentCli, probeAgentCli } from './agent-cli.ts'

/** Lays out what the Claude desktop app downloads for its Code tab on this platform. */
function desktopClaude(home: string, version: string): string {
  const executable =
    process.platform === 'darwin'
      ? path.join(
          home,
          'Library',
          'Application Support',
          'Claude',
          'claude-code',
          version,
          '4fa9694b7975',
          'claude.app',
          'Contents',
          'MacOS',
          'claude',
        )
      : path.join(home, '.config', 'Claude', 'claude-code', version, 'claude')

  mkdirSync(path.dirname(executable), { recursive: true })
  writeFileSync(executable, '#!/bin/sh\necho "$1" >/dev/null\necho "2.1.0 (Claude Code)"\n', {
    mode: 0o700,
  })

  return executable
}

/** A Claude Code in a fixed install location (e.g. /usr/local/bin) would win over the app copy. */
const systemClaude = findAgentCli('claude-code', { HOME: os.tmpdir(), PATH: '' })

test(
  'the Claude desktop app copy of Claude Code is listed newest first and is app-managed',
  { skip: process.platform === 'win32' },
  (t) => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'nuphos-claude-desktop-'))

    t.after(() => rmSync(home, { recursive: true, force: true }))
    const env = { HOME: home, PATH: '' }

    assert.deepEqual(claudeDesktopClis(env), [])
    const older = desktopClaude(home, '2.1.99')
    const newest = desktopClaude(home, '2.1.299')

    assert.deepEqual(claudeDesktopClis(env), [newest, older])
    assert.equal(appManagedCli(newest, env), true)
    assert.equal(appManagedCli(path.join(home, '.local', 'bin', 'claude'), env), false)
  },
)

test(
  'without any other install, the probe runs the desktop app copy',
  { skip: process.platform === 'win32' || systemClaude !== null },
  async (t) => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'nuphos-claude-probe-'))

    t.after(() => rmSync(home, { recursive: true, force: true }))
    const env = { HOME: home, PATH: path.join(home, 'empty') }

    assert.equal(findAgentCli('claude-code', env), null)
    const newest = desktopClaude(home, '2.1.299')

    assert.equal(findAgentCli('claude-code', env), newest)
    assert.equal(findAgentCli('codex', env), null)
    const status = await probeAgentCli('claude-code', env, undefined)

    assert.equal(status.installed && status.path, newest)
    assert.equal(status.installed && status.bundled, true)
  },
)

test(
  'a CLI on PATH wins over the desktop app copy and is not app-managed',
  { skip: process.platform === 'win32' },
  (t) => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'nuphos-claude-path-'))

    t.after(() => rmSync(home, { recursive: true, force: true }))
    const bin = path.join(home, 'bin')

    mkdirSync(bin)
    writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\n', { mode: 0o700 })
    desktopClaude(home, '2.1.299')
    const env = { HOME: home, PATH: bin }

    assert.equal(findAgentCli('claude-code', env), path.join(bin, 'claude'))
    assert.equal(appManagedCli(path.join(bin, 'claude'), env), false)
  },
)
