import { expect, test } from 'bun:test'

import { withSharedQuota } from './runtime-quota-shape'

import type { RuntimeInstance } from './runtime-instances'
import type { RuntimeQuota } from './runtime-quota-shape'

const quota = (runtimeId: string, accountKey?: string): RuntimeQuota => ({
  runtimeId,
  provider: 'claude-code',
  fetchedAt: '2026-11-17T00:00:00.000Z',
  available: true,
  windows: [],
  ...(accountKey ? { accountKey } : {}),
})
const instances = [
  { id: 'a', label: 'Yuanlin (6.25x) in Box' },
  { id: 'b', label: 'Yuanlin (20x) in Box' },
  { id: 'c', label: 'Can in Mac' },
  { id: 'd', label: 'Pan in Box' },
]

test('agents on one account each name the others they share its quota with', () => {
  const [a, b, c, d] = withSharedQuota(
    [quota('a', 'k1'), quota('b', 'k2'), quota('c', 'k1'), quota('d')],
    instances,
  )

  expect(a?.sharesQuotaWith).toEqual([{ runtimeId: 'c', label: 'Can in Mac' }])
  expect(c?.sharesQuotaWith).toEqual([{ runtimeId: 'a', label: 'Yuanlin (6.25x) in Box' }])
  // Alone on its account, or with no account known: nothing to share.
  expect(b?.sharesQuotaWith).toBeUndefined()
  expect(d?.sharesQuotaWith).toBeUndefined()
})

test('an agent on a computer is grouped by the account its presence reported', () => {
  const local = (id: string, accountKey: string) => ({
    id,
    label: id,
    local: { accountKey } as RuntimeInstance['local'],
  })
  const [a, b] = withSharedQuota([quota('a'), quota('b')], [local('a', 'k1'), local('b', 'k1')])

  expect(a?.sharesQuotaWith).toEqual([{ runtimeId: 'b', label: 'b' }])
  expect(b?.sharesQuotaWith).toEqual([{ runtimeId: 'a', label: 'a' }])
})
