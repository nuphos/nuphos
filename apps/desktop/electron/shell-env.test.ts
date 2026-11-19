import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseEnvBlock } from './shell-env.ts'

test('the last variable env prints keeps its exact value', () => {
  // A trailing newline on HOME made the local runtime drop its sign-in command.
  assert.deepEqual(parseEnvBlock('PATH=/usr/bin\nHOME=/Users/me\n'), {
    PATH: '/usr/bin',
    HOME: '/Users/me',
  })
})

test('a multiline value keeps its inner and trailing newlines', () => {
  assert.deepEqual(parseEnvBlock('A=one\ntwo\n\nB=x\n'), { A: 'one\ntwo\n', B: 'x' })
})
