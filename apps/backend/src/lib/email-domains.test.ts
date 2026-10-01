import { describe, expect, test } from 'bun:test'

import { extractEmailDomain, isPublicEmailDomain, normalizeEmailDomain } from '@/lib/email-domains'

describe('normalizeEmailDomain', () => {
  test('lowercases, trims, and strips a leading @', () => {
    expect(normalizeEmailDomain(' @Acme.COM ')).toBe('acme.com')
    expect(normalizeEmailDomain('zeabur.com')).toBe('zeabur.com')
    expect(normalizeEmailDomain('sub.acme.co.uk')).toBe('sub.acme.co.uk')
  })

  test('rejects values that are not a plausible company domain', () => {
    expect(normalizeEmailDomain('')).toBeNull()
    expect(normalizeEmailDomain('com')).toBeNull() // bare TLD
    expect(normalizeEmailDomain('acme')).toBeNull() // no dot
    expect(normalizeEmailDomain('user@acme.com')).toBeNull()
    expect(normalizeEmailDomain('-acme.com')).toBeNull()
    expect(normalizeEmailDomain('acme..com')).toBeNull()
    expect(normalizeEmailDomain('acme.com/path')).toBeNull()
    expect(normalizeEmailDomain('acme.c0m!')).toBeNull()
  })
})

describe('extractEmailDomain', () => {
  test('extracts the normalized domain from an address', () => {
    expect(extractEmailDomain('Pat@Zeabur.com')).toBe('zeabur.com')
    expect(extractEmailDomain('a+tag@sub.acme.io')).toBe('sub.acme.io')
  })

  test('returns null for malformed addresses', () => {
    expect(extractEmailDomain('not-an-email')).toBeNull()
    expect(extractEmailDomain('user@')).toBeNull()
    expect(extractEmailDomain('user@localhost')).toBeNull()
  })
})

describe('isPublicEmailDomain', () => {
  test('flags public mailbox providers', () => {
    expect(isPublicEmailDomain('gmail.com')).toBe(true)
    expect(isPublicEmailDomain('qq.com')).toBe(true)
    expect(isPublicEmailDomain('outlook.com')).toBe(true)
  })

  test('allows company domains', () => {
    expect(isPublicEmailDomain('zeabur.com')).toBe(false)
    expect(isPublicEmailDomain('anthropic.com')).toBe(false)
  })
})
