import assert from 'node:assert/strict'
import { test } from 'node:test'

import { deviceCodePrompt, VERIFICATION_URI } from '../image/opencode-login.mjs'

// What `opencode providers login` prints without a terminal, spinner escapes included.
const OUTPUT =
  '\u001b[0m\n┌  Add credential\n│\n●  Go to: https://auth.openai.com/codex/device\n│\n' +
  '●  Enter code: OK56-I2VNV\n\u001b[?25l│\n◒  Waiting for authorization\u001b[999D\u001b[J'

test('the device code is reported once OpenCode prints it', () => {
  assert.deepEqual(deviceCodePrompt(OUTPUT), {
    type: 'device',
    verificationUri: VERIFICATION_URI,
    userCode: 'OK56-I2VNV',
  })
})

test('nothing is reported before the code, or for another page', () => {
  assert.equal(deviceCodePrompt(OUTPUT.slice(0, OUTPUT.indexOf('Enter code'))), null)
  assert.equal(deviceCodePrompt(OUTPUT.replace('auth.openai.com', 'example.com')), null)
})
