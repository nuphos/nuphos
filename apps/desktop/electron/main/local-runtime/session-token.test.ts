import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { readSessionToken } from './session-token.ts'

function configFile(text: string): string {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'nuphos-host-')), 'cli.yaml')

  writeFileSync(file, text)

  return file
}

test('a token in the file needs no CLI', () => {
  const file = configFile('token: tok-1\n')

  assert.equal(
    readSessionToken(file, () => assert.fail('no CLI')),
    'tok-1',
  )
})

test('a keychain token is read through the CLI once per file change', () => {
  const file = configFile('keychainAccount: u1@https://api.nuphos.ai\n')
  let calls = 0
  const cli = () => {
    calls++

    return { status: 0, stdout: 'tok-1\n' }
  }

  assert.equal(readSessionToken(file, cli), 'tok-1')
  assert.equal(readSessionToken(file, cli), 'tok-1')
  assert.equal(calls, 1)
})

test('a CLI that reports signed out ends the session, one that fails to run does not', () => {
  const file = configFile('keychainAccount: u2@https://api.nuphos.ai\n')

  assert.equal(
    readSessionToken(file, () => ({ status: 0, stdout: 'tok-2\n' })),
    'tok-2',
  )
  writeFileSync(file, 'keychainAccount: u2@https://api.nuphos.ai\nuser: x\n')
  assert.equal(
    readSessionToken(file, () => ({ status: null, stdout: '' })),
    'tok-2',
  )
  assert.equal(
    readSessionToken(file, () => ({ status: 1, stdout: '' })),
    null,
  )
})

test('no file or no sign-in reads as signed out', () => {
  assert.equal(readSessionToken('/nonexistent/cli.yaml'), null)
  assert.equal(
    readSessionToken(configFile('{}\n'), () => assert.fail('no CLI')),
    null,
  )
})
