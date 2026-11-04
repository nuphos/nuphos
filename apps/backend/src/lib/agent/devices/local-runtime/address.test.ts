import { expect, test } from 'bun:test'

import { localRuntimeUrl, sameRuntimeUrl } from './address'

const mac = { userId: 'owner', deviceId: 'mac', provider: 'claude-code' } as const

test('who acts on a computer never makes it another runtime', () => {
  const owners = localRuntimeUrl(mac, 'team')
  const teammates = localRuntimeUrl(mac, 'team', 'teammate')

  expect(owners).not.toBe(teammates)
  expect(sameRuntimeUrl(owners, teammates)).toBe(true)
  expect(sameRuntimeUrl(teammates, localRuntimeUrl(mac, 'team', 'someone-else'))).toBe(true)
})

test('another computer, agent, instance or team is another runtime', () => {
  const owners = localRuntimeUrl(mac, 'team')

  expect(sameRuntimeUrl(owners, localRuntimeUrl({ ...mac, deviceId: 'pc' }, 'team'))).toBe(false)
  expect(sameRuntimeUrl(owners, localRuntimeUrl({ ...mac, provider: 'codex' }, 'team'))).toBe(false)
  expect(
    sameRuntimeUrl(
      owners,
      localRuntimeUrl({ ...mac, instanceId: '6f1c1f0e-8a7e-4b1a-9d43-1f3a2b4c5d6e' }, 'team'),
    ),
  ).toBe(false)
  expect(sameRuntimeUrl(owners, localRuntimeUrl(mac, 'other-team'))).toBe(false)
})

test('a hosted runtime compares as it is, and nothing matches a missing address', () => {
  expect(sameRuntimeUrl('wss://runtime.invalid/acp', 'wss://runtime.invalid/acp')).toBe(true)
  expect(sameRuntimeUrl('wss://runtime.invalid/acp?actor=x', 'wss://runtime.invalid/acp')).toBe(
    false,
  )
  expect(sameRuntimeUrl(undefined, localRuntimeUrl(mac, 'team'))).toBe(false)
})
