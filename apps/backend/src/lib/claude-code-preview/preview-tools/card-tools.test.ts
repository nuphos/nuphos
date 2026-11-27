import { describe, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useSlackAgentBot } from '@/lib/test/doubles/slack-agent-bot'

import type { AgentConversation } from '@/lib/agent/db'

let conversation: Partial<AgentConversation> = {}

useAgentDb({
  getConversationBySessionId: () => Promise.resolve(conversation as AgentConversation),
  getConversationMemoryProvider: () => Promise.resolve(null),
})
useSlackAgentBot({ getSlackAgentThreadBySessionId: () => Promise.resolve(null) })

const { resolvePreviewToolContext } = await import('../preview-tool-context-resolve')
const { previewAiSdkToolSets } = await import('./index')

async function toolNames(doc: Partial<AgentConversation>) {
  conversation = { sessionId: 's', userId: 'u', teamId: 't', ...doc }
  const ctx = await resolvePreviewToolContext({ userId: 'u', teamId: 't', sessionId: 's' })

  return Object.values(await previewAiSdkToolSets(ctx)).flatMap((tools) => Object.keys(tools))
}

describe('chart and artifact tools', () => {
  test('a Task gets both, as its conversation draws their cards', async () => {
    const names = await toolNames({})

    expect(names).toContain('render_chart')
    expect(names).toContain('render_artifact')
  })

  // #5272: a Bot's chat shows only its posts, so the card it was told was open never showed.
  test('a Bot gets neither', async () => {
    const names = await toolNames({ avatar: 'robot' })

    expect(names).not.toContain('render_chart')
    expect(names).not.toContain('render_artifact')
  })
})
