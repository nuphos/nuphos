import { describe, expect, test } from 'bun:test'

import {
  assertRuntimePasswordLength,
  defaultExternalRuntimeLabel,
  registerExternalRuntimeSchema,
  registerRuntimeSchema,
  rotateRuntimeKeysSchema,
} from './claude-code-runtimes'

const LONG = 'a'.repeat(32)

describe('external runtime key floor', () => {
  test('a short password is refused with a message that says what is wrong', () => {
    // A schema failure reaches the app only as "Invalid input", so the floor is
    // enforced where it can name the problem and the fix.
    expect(() => {
      assertRuntimePasswordLength('a'.repeat(31))
    }).toThrow(
      'The admin password must be at least 32 characters; this one is 31. `openssl rand -hex 32` makes one that fits.',
    )
    expect(() => {
      assertRuntimePasswordLength(LONG)
    }).not.toThrow()
  })

  test('a short operator key is refused too', () => {
    expect(() => {
      assertRuntimePasswordLength(LONG, 'a'.repeat(31))
    }).toThrow('The operator key must be at least 32 characters; this one is 31.')
  })

  test('the schema leaves the floor to the handler, so its message is the one shown', () => {
    expect(
      registerRuntimeSchema.safeParse({ url: 'wss://openab.example/acp', authKey: 'a'.repeat(31) })
        .success,
    ).toBe(true)
  })

  test('accepts a registration with both credentials', () => {
    expect(
      registerRuntimeSchema.safeParse({
        url: 'wss://openab.example/acp',
        authKey: LONG,
        controlKey: 'b'.repeat(32),
        label: 'vps',
      }).success,
    ).toBe(true)
  })

  test('one password is a complete registration', () => {
    expect(
      registerRuntimeSchema.safeParse({ url: 'wss://openab.example/acp', authKey: LONG }).success,
    ).toBe(true)
  })

  test('rotation takes one password too and rejects unknown fields', () => {
    expect(rotateRuntimeKeysSchema.safeParse({ authKey: LONG }).success).toBe(true)
    expect(rotateRuntimeKeysSchema.safeParse({ authKey: LONG, url: 'x' }).success).toBe(false)
    expect(rotateRuntimeKeysSchema.safeParse({ authKey: '' }).success).toBe(false)
  })
})

describe('provider-agnostic external registration', () => {
  test('provider is optional so the backend can detect it', () => {
    expect(
      registerExternalRuntimeSchema.safeParse({ url: 'wss://openab.example/acp', authKey: LONG })
        .success,
    ).toBe(true)
    expect(
      registerExternalRuntimeSchema.safeParse({
        url: 'wss://openab.example/acp',
        authKey: LONG,
        provider: 'codex',
      }).success,
    ).toBe(true)
    expect(
      registerExternalRuntimeSchema.safeParse({
        url: 'wss://openab.example/acp',
        authKey: LONG,
        provider: 'gemini',
      }).success,
    ).toBe(false)
  })

  test('older clients that still send a name keep working', () => {
    expect(
      registerExternalRuntimeSchema.safeParse({
        url: 'wss://openab.example/acp',
        authKey: LONG,
        label: 'vps',
      }).success,
    ).toBe(true)
  })
})

describe('default external runtime label', () => {
  test('is the address hostname', () => {
    expect(defaultExternalRuntimeLabel('wss://runtime.example.com/acp')).toBe('runtime.example.com')
    expect(defaultExternalRuntimeLabel('ws://openab.team-a.svc:8080/acp')).toBe('openab.team-a.svc')
  })

  test('is absent for an unparseable address', () => {
    expect(defaultExternalRuntimeLabel('not a url')).toBeUndefined()
  })
})
