import { expect, test } from 'bun:test'

import { normalizeClaudeUsage } from './runtime-quota-claude'

import type { RuntimeInstance } from './runtime-instances'

const fetchedAt = '2026-11-17T11:30:00.000Z'
const claude: RuntimeInstance = {
  id: 'claude-1',
  provider: 'claude-code',
  label: 'Claude',
  status: 'active',
  kind: 'managed',
  createdAt: fetchedAt,
}
const seven_day = { utilization: 45, resets_at: '2026-11-18T15:00:00.319033+00:00' }

/** A real answer to `GET /api/oauth/usage?cedar_ember=1` from a Max account, ids redacted. */
const grant = {
  id: 'grant_redacted',
  label: 'One full limit reset (November 2026)',
  resets_total: 1,
  resets_left: 1,
  starts_at: '2026-11-10T21:30:00+00:00',
  ends_at: '2026-12-10T22:00:00+00:00',
  clears: ['seven_day', 'seven_day_overage_included'],
  paused: false,
  usable_now: true,
  use_requires_limit: false,
  type: 'weekly',
}
const eligible = {
  eligible: true,
  ineligible_reason: null,
  at_limit: false,
  exhausted: [],
  grants: [grant],
  next_grant_id: 'grant_redacted',
  weekly_resets_at: null,
  cooldown_until: null,
  event_props: null,
}

test('reads the resets a Claude account holds', () => {
  const quota = normalizeClaudeUsage(claude, { seven_day, cedar_ember: eligible }, fetchedAt)

  expect(quota.windows).toHaveLength(1)
  expect(quota.resets).toEqual({
    left: 1,
    expiresAt: '2026-12-10T22:00:00+00:00',
    usableNow: true,
    kind: 'weekly',
  })
})

test('adds up every grant and names the one that expires first', () => {
  const quota = normalizeClaudeUsage(
    claude,
    {
      seven_day,
      cedar_ember: {
        ...eligible,
        grants: [
          grant,
          { ...grant, resets_left: 2, ends_at: '2026-11-30T09:00:00+09:00', usable_now: false },
          { ...grant, type: 'fable', ends_at: '2027-03-09T07:59:00+00:00' },
          { ...grant, resets_left: 3, paused: true, ends_at: '2026-11-20T00:00:00Z' },
          { ...grant, resets_left: 0, ends_at: '2026-11-19T00:00:00Z' },
        ],
      },
    },
    fetchedAt,
  )

  // The first usable grant to expire is the one spent next.
  expect(quota.resets).toEqual({
    left: 4,
    expiresAt: '2026-11-30T09:00:00+09:00',
    usableNow: true,
    kind: 'weekly',
  })
})

test('an account the server will not offer resets to holds none, and says so', () => {
  const quota = normalizeClaudeUsage(
    claude,
    {
      seven_day,
      cedar_ember: { ...eligible, eligible: false, ineligible_reason: 'surface', grants: [] },
    },
    fetchedAt,
  )

  expect(quota.available).toBe(true)
  expect(quota.resets).toEqual({ left: 0, expiresAt: null, usableNow: false, kind: null })
})

test('without a reset block, the owner has not opted in', () => {
  expect(normalizeClaudeUsage(claude, { seven_day }, fetchedAt).resets).toBeUndefined()
})

test('a reset block that does not fit costs the resets, never the usage', () => {
  for (const cedar_ember of [null, 'x', { grants: 'x' }]) {
    const quota = normalizeClaudeUsage(claude, { seven_day, cedar_ember }, fetchedAt)

    expect(quota.windows).toHaveLength(1)
    expect(quota.resets).toBeUndefined()
  }
  const unreadable = normalizeClaudeUsage(
    claude,
    { seven_day, cedar_ember: { grants: [{ resets_left: -1 }, { resets_left: 'one' }, null] } },
    fetchedAt,
  )

  expect(unreadable.resets?.left).toBe(0)
})
