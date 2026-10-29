import { describe, expect, test } from 'bun:test'

import { config } from '@/config'

import {
  buildAttributionJudgePrompt,
  buildJudgeCandidates,
  judgeSampledIn,
  runAttributionJudge,
} from './attribution-judge'

const e = (memoryId: string, label: string) => ({ memoryId, scope: 'team' as const, label })

describe('judgeSampledIn', () => {
  const keys = Array.from({ length: 1000 }, (_, i) => `req-${String(i)}`)

  test('rate 1 always samples in, rate 0 never does', () => {
    expect(keys.every((k) => judgeSampledIn(k, 1))).toBe(true)
    expect(keys.some((k) => judgeSampledIn(k, 0))).toBe(false)
  })

  test('deterministic: the same turnKey always gets the same decision', () => {
    for (const k of keys.slice(0, 20)) {
      expect(judgeSampledIn(k, 0.5)).toBe(judgeSampledIn(k, 0.5))
    }
  })

  test('monotonic: a turn sampled in at a low rate stays in at any higher rate', () => {
    for (const k of keys.slice(0, 50)) {
      if (judgeSampledIn(k, 0.2)) {
        expect(judgeSampledIn(k, 0.7)).toBe(true)
      }
    }
  })

  test('rate 0.5 samples roughly half of a large key set', () => {
    const hit = keys.filter((k) => judgeSampledIn(k, 0.5)).length

    expect(hit).toBeGreaterThan(400)
    expect(hit).toBeLessThan(600)
  })

  test('a non-finite rate fails open to running the judge', () => {
    expect(judgeSampledIn('x', Number.NaN)).toBe(true)
  })
})

describe('buildJudgeCandidates (A4②)', () => {
  test('fetched memories in fetch order, capped at 12, scoped by the fetch', () => {
    const fetched = new Map(
      Array.from({ length: 14 }, (_, i) => [`f${String(i)}`, `fetched ${String(i)}`] as const),
    )
    const out = buildJudgeCandidates(fetched, ['f1'])

    expect(out).toHaveLength(12)
    expect(out[0]).toEqual({ memoryId: 'f0', scope: 'team', label: 'fetched 0' })
    expect(out[1]!.scope).toBe('personal')
  })

  test('zero candidates stays zero', () => {
    expect(buildJudgeCandidates(new Map(), [])).toHaveLength(0)
  })
})

describe('runAttributionJudge provider param', () => {
  test('accepts an optional provider (default native) and stays a no-op when the flag is off', async () => {
    // Phase 2 signature lock: the runtime stamps the resolved provider; the
    // omitted form keeps existing finalizer callers green. Behavior with the
    // judge flag off is an immediate return — no store/model access, so this
    // must resolve without any mocks in place.
    expect(config.agent.memoryAttributionJudge).toBe(false)
    const base = {
      teamId: null,
      userId: 'u1',
      conversationId: 'c1',
      turnKey: 'req-1',
      query: 'q',
      answer: 'a',
      fetchedLabels: new Map<string, string>(),
      fetchedPersonalIds: [],
    }

    await expect(runAttributionJudge(base)).resolves.toBeUndefined()
    await expect(runAttributionJudge({ ...base, provider: 'vendor-x' })).resolves.toBeUndefined()
  })
})

describe('buildAttributionJudgePrompt', () => {
  test('JSON payload, ids present, data-not-instruction wording', () => {
    const prompt = buildAttributionJudgePrompt('why is the pod down', 'checked exit 137', [
      e('m1', 'OOM triage'),
    ])

    expect(prompt).toContain('"m1"')
    expect(prompt).toContain('DATA')
    expect(() => JSON.parse(prompt.slice(prompt.indexOf('{')))).not.toThrow()
  })

  test('caps query/answer/label lengths', () => {
    const prompt = buildAttributionJudgePrompt('q'.repeat(5000), 'a'.repeat(9000), [
      e('m1', 'L'.repeat(500)),
    ])
    const payload = JSON.parse(prompt.slice(prompt.indexOf('{')))

    expect(payload.userQuery.length).toBeLessThanOrEqual(2000)
    expect(payload.assistantAnswer.length).toBeLessThanOrEqual(4000)
    expect(payload.memories[0].label.length).toBeLessThanOrEqual(200)
  })
})
