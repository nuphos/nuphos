import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { findAgentCli, npmShimTarget } from './agent-cli-find.ts'

/** The .cmd shim npm's cmd-shim writes on Windows around a package's executable bin. */
const exeShim = (bin: string) =>
  '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n' +
  `"%dp0%\\node_modules\\${bin.split('/').join('\\')}"   %*\r\n`

/** What `npm install -g <package>` leaves in %APPDATA%\npm on Windows, for a package whose bin
 *  `bin` (relative to node_modules) is an executable. */
function npmGlobal(
  command: string,
  bin: string,
  withExe: boolean,
): { root: string; shim: string; exe: string; done: () => void } {
  const root = mkdtempSync(path.join(os.tmpdir(), `nuphos-npm-${command}-`))
  const npm = path.join(root, 'AppData', 'Roaming', 'npm')
  const exe = path.join(npm, 'node_modules', ...bin.split('/'))
  const shim = path.join(npm, `${command}.cmd`)

  mkdirSync(path.dirname(exe), { recursive: true })
  writeFileSync(shim, exeShim(bin))
  if (withExe) writeFileSync(exe, '', { mode: 0o755 })

  return { root, shim, exe, done: () => rmSync(root, { recursive: true, force: true }) }
}

for (const [provider, command, bin] of [
  ['claude-code', 'claude', '@anthropic-ai/claude-code/bin/claude.exe'],
  ['opencode', 'opencode', 'opencode-ai/bin/opencode.exe'],
] as const)
  test(`on Windows, npm's ${command}.cmd shim resolves to the ${command}.exe it runs`, (t) => {
    const { root, exe, done } = npmGlobal(command, bin, true)
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!

    // Agents spawn this path without a shell, and Node refuses a .cmd that way (EINVAL).
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

    assert.equal(findAgentCli(provider, env), exe)
  })

test('a .cmd shim whose executable is missing is kept as found', (t) => {
  const { shim, done } = npmGlobal('opencode', 'opencode-ai/bin/opencode.exe', false)

  t.after(done)
  assert.equal(npmShimTarget(shim), shim)
})

test('a .cmd shim around a Node script is kept as found, even beside node.exe', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nuphos-npm-codex-'))
  const shim = path.join(root, 'codex.cmd')

  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(path.join(root, 'node.exe'), '', { mode: 0o755 })
  writeFileSync(
    shim,
    '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\n' +
      'IF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n)\r\n\r\n' +
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n',
  )
  assert.equal(npmShimTarget(shim), shim)
})

test('a CLI that is not a .cmd is kept as found', () => {
  const file = path.join('C:', 'Users', 'u', '.local', 'bin', 'claude.exe')

  assert.equal(npmShimTarget(file), file)
})
