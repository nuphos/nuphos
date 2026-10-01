import assert from 'node:assert/strict'
import test from 'node:test'

import { trustedAvatarURL } from './avatarUrl.ts'

test('shared-message avatars reject untrusted and disguised image hosts', () => {
  assert.equal(
    trustedAvatarURL('https://lh3.googleusercontent.com/a'),
    'https://lh3.googleusercontent.com/a',
  )
  for (const value of [
    'https://tracker.example/pixel',
    'https://lh3.googleusercontent.com.evil.example/a',
    'https://user@lh3.googleusercontent.com/a',
    'http://lh3.googleusercontent.com/a',
    'https://lh3.googleusercontent.com:8443/a',
    '',
  ]) {
    assert.equal(trustedAvatarURL(value), undefined)
  }
})
