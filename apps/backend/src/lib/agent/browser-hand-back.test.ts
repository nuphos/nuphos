import { expect, test } from 'bun:test'

import { useConversationTurn } from '@/lib/test/doubles/conversation-turn'

const turns: { text: string; sender: string; session: string; source: string }[] = []

useConversationTurn({
  startConversationTurn: async (data, _target, text, source, metadata) => {
    turns.push({ text, sender: metadata?.sender.id ?? '', session: data.targetSessionId, source })

    return { status: 'started' as const, run: Promise.resolve(undefined) }
  },
})

const { wakeOnHandBack } = await import('./browser-hand-back')

test('closing a shown window wakes its conversation as Nuphos, naming the tab', async () => {
  await wakeOnHandBack({ sessionId: 's1', userId: 'owner', teamId: 't1' } as never, 't1', 12)

  expect(turns).toHaveLength(1)
  expect(turns[0]).toMatchObject({
    session: 's1',
    sender: 'nuphos:browser',
    source: 'agent.resource',
  })
  expect(turns[0]?.text).toContain('tab 12')
  expect(turns[0]?.text).toContain('Read the page')
})
