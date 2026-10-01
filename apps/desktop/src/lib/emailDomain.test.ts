import assert from 'node:assert/strict'
import { test } from 'node:test'

import { extractEmailDomain, signInEmailError } from './emailDomain.ts'

test('signInEmailError accepts personal and work email addresses', () => {
  assert.equal(signInEmailError('person@gmail.com'), null)
  assert.equal(signInEmailError('person@outlook.com'), null)
  assert.equal(signInEmailError('person@icloud.com'), null)
  assert.equal(signInEmailError('operator@company.example'), null)
})

test('signInEmailError still rejects malformed addresses', () => {
  assert.equal(signInEmailError(''), 'Enter a valid email address.')
  assert.equal(signInEmailError('@gmail.com'), 'Enter a valid email address.')
  assert.equal(signInEmailError('person@@gmail.com'), 'Enter a valid email address.')
  assert.equal(signInEmailError('person gmail.com'), 'Enter a valid email address.')
  assert.equal(signInEmailError('person@localhost'), 'Enter a valid email address.')
})

test('extractEmailDomain normalizes a valid address domain', () => {
  assert.equal(extractEmailDomain('Person@GMAIL.COM '), 'gmail.com')
})
