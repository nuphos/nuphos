import { expect, test } from 'bun:test'

import { makeTokenUsageRecordsForModelCall } from './token-usage'

test('chat usage keeps provider cost telemetry without billable or prepaid usage', () => {
  const records = makeTokenUsageRecordsForModelCall({
    recordPrefix: 'free-chat',
    sessionId: 'session',
    userId: 'user',
    teamId: 'team',
    operation: 'chat',
    source: 'ai-sdk',
    provider: 'vertex',
    modelId: 'claude-opus-5',
    usage: { inputTokens: 1000, outputTokens: 100, totalTokens: 1100 },
  })

  expect(records.length).toBeGreaterThan(0)
  expect(records.every((record) => record.billing === 'background')).toBe(true)
  const total = records.find((record) => record.kind === 'step_total')!

  expect(total.providerCostUsd).toBeGreaterThan(0)
  expect(total.tokens.totalTokens).toBe(1100)
})
