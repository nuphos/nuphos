import { describe, expect, test } from 'bun:test'

import { AgentJournal } from './journal'

import type { JournalWriter } from '@/lib/journal'

function makeJournal() {
  const appends: { type: string; payload: Record<string, unknown> }[] = []
  const writer = {
    append: async (entry: { type: string; payload: Record<string, unknown> }) => {
      appends.push({ type: entry.type, payload: entry.payload })
    },
  } as unknown as JournalWriter

  const journal = new AgentJournal({
    userId: 'u1',
    teamId: 't1',
    conversationId: 'c1',
    requestId: 'r1',
    streamId: 's1',
    modelId: 'claude-opus-5',
    writer,
  })

  return { journal, appends }
}

describe('AgentJournal.turnEnd — finishReason', () => {
  test('records the finishReason on the turn_end event', async () => {
    const { journal, appends } = makeJournal()

    await journal.turnEnd({ finishReason: 'content-filter', messageCount: 3 })

    const turnEnd = appends.find((a) => a.type === 'turn_end')

    expect(turnEnd?.payload).toEqual({ finishReason: 'content-filter', messageCount: 3 })
  })

  test('defaults finishReason to null when omitted', async () => {
    const { journal, appends } = makeJournal()

    await journal.turnEnd({ messageCount: 1 })

    const turnEnd = appends.find((a) => a.type === 'turn_end')

    expect(turnEnd?.payload.finishReason).toBeNull()
  })
})
