import { describe, expect, test } from 'bun:test'

import { decayScore, rankByDecay } from './decay'

const NOW = new Date('2026-07-16T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)

describe('decayScore', () => {
  test('fresher update scores higher', () => {
    expect(decayScore(NOW, { updatedAt: hoursAgo(1) })).toBeGreaterThan(
      decayScore(NOW, { updatedAt: hoursAgo(100) }),
    )
  })

  test('a recent fetch resets the clock ahead of a stale updatedAt', () => {
    const fetchedOld = { updatedAt: hoursAgo(500), lastFetchedAt: hoursAgo(2) }
    const untouchedNewer = { updatedAt: hoursAgo(200) }

    expect(decayScore(NOW, fetchedOld)).toBeGreaterThan(decayScore(NOW, untouchedNewer))
  })

  test('lastVerifiedAt (trust clock) counts like any newest signal', () => {
    const verified = { updatedAt: hoursAgo(500), lastVerifiedAt: hoursAgo(1) }

    expect(decayScore(NOW, verified)).toBeGreaterThan(decayScore(NOW, { updatedAt: hoursAgo(500) }))
  })

  test('fetch frequency boosts log-damped, never unbounded', () => {
    const base = { updatedAt: hoursAgo(10) }
    const s0 = decayScore(NOW, base)
    const s10 = decayScore(NOW, { ...base, fetchCount: 10 })
    const s1000 = decayScore(NOW, { ...base, fetchCount: 1000 })

    expect(s10).toBeGreaterThan(s0)
    expect(s1000 / s10).toBeLessThan(4)
  })

  test('future timestamps clamp to score 1×frequency, not explode', () => {
    expect(decayScore(NOW, { updatedAt: hoursAgo(-5) })).toBe(1)
  })
})

describe('rankByDecay', () => {
  test('orders by score, ties broken by updatedAt desc', () => {
    const a = { id: 'a', updatedAt: hoursAgo(1) }
    const b = { id: 'b', updatedAt: hoursAgo(300), lastFetchedAt: hoursAgo(1), fetchCount: 3 }
    const c = { id: 'c', updatedAt: hoursAgo(300) }
    const out = rankByDecay(NOW, [c, a, b])

    expect(out.map((x) => x.id)).toEqual(['b', 'a', 'c'])
  })
})
