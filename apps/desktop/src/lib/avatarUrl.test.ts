import assert from 'node:assert/strict'
import test from 'node:test'

import { trustedAvatarURL } from './avatarUrl.ts'

const uploaded = `/avatars/0123456789abcdef01234567/${'a'.repeat(64)}.webp`

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

test('uploaded photos are trusted only with the exact backend path shape', () => {
  for (const value of [`https://api.nuphos.ai${uploaded}`, `http://localhost:3000${uploaded}`]) {
    assert.equal(trustedAvatarURL(value), value)
  }
  for (const value of [
    `http://api.example.com${uploaded}`,
    `https://api.nuphos.ai${uploaded}?track=1`,
    `https://api.nuphos.ai${uploaded.replace('.webp', '.svg')}`,
    'https://api.nuphos.ai/avatars/me/pixel.webp',
  ]) {
    assert.equal(trustedAvatarURL(value), undefined)
  }
})
