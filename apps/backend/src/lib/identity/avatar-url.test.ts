import { expect, test } from 'bun:test'

import { config } from '@/config'

import { hostedAvatarOwner, trustedAvatarURL } from './avatar-url'

const base = config.auth.publicBaseUrl
const id = '0123456789abcdef01234567'
const hash = 'a'.repeat(64)

test('uploaded avatars are trusted only on this backend with the exact path shape', () => {
  const hosted = `${base}/avatars/${id}/${hash}.webp`

  expect(trustedAvatarURL(hosted)).toBe(hosted)
  expect(hostedAvatarOwner(hosted)).toBe(id)
  for (const url of [
    `https://evil.example/avatars/${id}/${hash}.webp`,
    `${base}/avatars/${id}/${hash}.svg`,
    `${base}/avatars/${id}/${hash}.webp?x=1`,
    `${base}/avatars/${id}/../${hash}.webp`,
    `${base}/other/${id}/${hash}.webp`,
  ]) {
    expect(trustedAvatarURL(url)).toBeUndefined()
  }
})

test('Google profile images stay trusted', () => {
  expect(trustedAvatarURL('https://lh3.googleusercontent.com/a/x=s96-c')).toBe(
    'https://lh3.googleusercontent.com/a/x=s96-c',
  )
  expect(trustedAvatarURL('https://lh3.googleusercontent.com.evil.example/a')).toBeUndefined()
  expect(hostedAvatarOwner('https://lh3.googleusercontent.com/a')).toBeUndefined()
})
