import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { findAgentCli, npmShimTarget } from './agent-cli-find.ts'

/** What `npm install -g @anthropic-ai/claude-code` leaves in %APPDATA%\npm on Windows. */
function npmGlobal(withExe: boolean): {
  root: string
  shim: string
  exe: string
  done: () => void
} {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nuphos-npm-claude-'))
  const npm = path.join(root, 'AppData', 'Roaming', 'npm')
  const exe = path.join(npm, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
  const shim = path.join(npm, 'claude.cmd')

  mkdirSync(path.dirname(exe), { recursive: true })
  writeFileSync(
    shim,
    '@ECHO off\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n',
  )
  if (withExe) writeFileSync(exe, '', { mode: 0o755 })

  return { root, shim, exe, done: () => rmSync(root, { recursive: true, force: true }) }
}

test("on Windows, npm's claude.cmd shim resolves to the claude.exe it runs", (t) => {
  const { root, exe, done } = npmGlobal(true)
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!

  // The Agent SDK spawns this path without a shell, and Node refuses a .cmd that way (EINVAL).
  Object.defineProperty(process, 'platform', { value: 'win32' })
  t.after(() => {
    Object.defineProperty(process, 'platform', platform)
    done()
  })
  const env = {
    USERPROFILE: root,
    APPDATA: path.join(root, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(root, 'AppData', 'Local'),
    PATH: '',
  }

  assert.equal(findAgentCli('claude-code', env), exe)
})

test('a claude.cmd without the npm package beside it is kept as found', (t) => {
  const { shim, done } = npmGlobal(false)

  t.after(done)
  assert.equal(npmShimTarget(shim), shim)
})

test('other CLIs are kept as found', () => {
  for (const file of [
    path.join('C:', 'Users', 'u', '.local', 'bin', 'claude.exe'),
    path.join('C:', 'Users', 'u', 'AppData', 'Roaming', 'npm', 'codex.cmd'),
  ])
    assert.equal(npmShimTarget(file), file)
})
