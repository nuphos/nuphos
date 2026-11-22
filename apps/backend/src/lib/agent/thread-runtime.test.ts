import { expect, test } from 'bun:test'

import { unavailableReason } from './thread-runtime'

const local = (signedIn: boolean | null, shared?: true) => ({
  provider: 'codex' as const,
  local: {
    ownerUserId: 'u',
    deviceId: 'd',
    deviceLabel: 'Box',
    online: true,
    signedIn,
    ...(shared ? { shared: { level: 'full' as const } } : {}),
  },
})

test('a signed-out agent on a computer is not ready, as its turns would be refused', () => {
  expect(unavailableReason(local(false))).toBe(
    'Signed out: sign in to Codex on that computer first.',
  )
})

test('a signed-in agent, or one whose computer cannot tell, stays ready', () => {
  expect(unavailableReason(local(true))).toBeUndefined()
  expect(unavailableReason(local(null))).toBeUndefined()
  expect(unavailableReason({ provider: 'claude-code' })).toBeUndefined()
})

test("a teammate's computer says so first", () => {
  expect(unavailableReason(local(false, true))).toContain("A teammate's computer")
})
