import { afterEach, expect, spyOn, test } from 'bun:test'

import { drainAgentProducers } from '@/lib/agent/producer-drain'
import * as lifecycle from '@/lib/lifecycle'
import { useAgentDb } from '@/lib/test/doubles/agent-db'

import { autonomous } from './chat-preview-autonomous-runs'

import type { ClaudeCodeAutonomousContext } from '@/lib/claude-code-preview/agent-chat-runtime'

const persisted: unknown[] = []
let writeGate: Promise<void> | undefined

useAgentDb({
  appendAutonomousConversationTurn: async (args) => {
    await writeGate
    persisted.push(args.message.parts)

    return true
  },
})

const context: ClaudeCodeAutonomousContext = {
  teamId: 'team-1',
  conversationId: 'conversation-drain',
  userId: 'actor-1',
  conversationOwnerUserId: 'owner-1',
  locale: 'en-US',
}

afterEach(() => {
  persisted.length = 0
})

// A turn whose transport dropped carries on as runtime-owned output. When the
// replica starts draining mid-turn, that output still reaches it, and the
// gateway delivers it nowhere else (#3796).
test('a draining replica still saves the rest of a turn the runtime carries on', async () => {
  const draining = spyOn(lifecycle, 'isShuttingDown').mockReturnValue(true)

  try {
    await autonomous.update({ ...context, update: { kind: 'text', text: 'The answer ' } })
    await autonomous.update({ ...context, update: { kind: 'text', text: 'is 42.' } })
    await autonomous.update({ ...context, update: { kind: 'complete' } })
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(JSON.stringify(persisted)).toContain('The answer is 42.')
  } finally {
    draining.mockRestore()
  }
})

// Shutdown closes device tunnels and then drains HTTP and producers. A turn the
// closed tunnel ends after that drain must still be saved before storage closes.
test('the last producer drain waits for a turn that ends after the HTTP drain', async () => {
  let release!: () => void

  writeGate = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    expect(await drainAgentProducers(100)).toBe(true)
    await autonomous.update({ ...context, update: { kind: 'text', text: 'Late output.' } })
    await autonomous.update({ ...context, update: { kind: 'complete' } })

    let drained: boolean | undefined
    const lastDrain = drainAgentProducers(1000).then((done) => {
      drained = done
    })

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(drained).toBeUndefined()
    release()
    await lastDrain
    expect(drained).toBe(true)
    expect(JSON.stringify(persisted)).toContain('Late output.')
  } finally {
    writeGate = undefined
    release()
  }
})
