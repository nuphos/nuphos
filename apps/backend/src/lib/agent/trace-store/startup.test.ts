import { expect, test } from 'bun:test'

import { config } from '@/config'
import { useDb } from '@/lib/test/doubles/db'
import { useObservability } from '@/lib/test/doubles/observability'

import { setupTraceIndexes } from './store'

const events: { event: string; properties: unknown }[] = []

useObservability({
  logEvent: (_level, event, properties) => {
    events.push({ event, properties })
  },
})
useDb({
  db: () => {
    throw new Error('Disabled tracing must not initialize Mongo collections')
  },
})

test('startup explicitly reports disabled full-content capture without enabling storage', async () => {
  const original = config.agent.mongoTraceSpoolPath

  config.agent.mongoTraceSpoolPath = undefined
  try {
    await setupTraceIndexes()
    expect(events).toContainEqual({
      event: 'agent.trace.disabled',
      properties: {
        reason: 'AGENT_MONGO_TRACE_SPOOL_PATH is not configured',
        full_content_capture: false,
      },
    })
  } finally {
    config.agent.mongoTraceSpoolPath = original
  }
})
