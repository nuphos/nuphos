import '@/routes/agent'

import { expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { fallbackTitle } from '@/lib/agent/title-fallback'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useModels } from '@/lib/test/doubles/models'
import { createFakeInstructionsCollection } from '@/lib/test/fake-instructions-collection'

import type { AgentConversation } from '@/lib/agent/db'

const TEAM_ID = new ObjectId()
const collection = createFakeInstructionsCollection()

useModels({ agentInstructions: () => collection })

// A new Task's record, once its first turn has stored it; absent before that.
let taskRecord: AgentConversation | null = null

useAgentDb({ getConversationBySessionId: () => Promise.resolve(taskRecord) })

const { buildPreviewSystemPrompt } = await import('./preview-prompt')

const now = new Date()

collection.docs.push(
  {
    _id: new ObjectId(),
    teamId: TEAM_ID,
    scope: 'team',
    userId: null,
    title: 'Change policy',
    content: 'Open a Plan before any production change.',
    enabled: true,
    createdAt: now,
    updatedAt: now,
    createdBy: 'admin',
    updatedBy: 'admin',
  },
  {
    _id: new ObjectId(),
    teamId: TEAM_ID,
    scope: 'personal',
    userId: 'user-1',
    title: 'Answer style',
    content: 'Lead with the answer.',
    enabled: true,
    createdAt: now,
    updatedAt: now,
    createdBy: 'user-1',
    updatedBy: 'user-1',
  },
)

for (const provider of ['claude-code', 'codex'] as const) {
  test(`${provider} sessions carry the acting member's instructions`, async () => {
    const prompt = await buildPreviewSystemPrompt({
      provider,
      userId: 'user-1',
      teamId: TEAM_ID.toHexString(),
      sessionId: 'conv-1',
      locale: 'en',
    })

    expect(prompt).toContain('<nuphos_instructions>')
    expect(prompt).toContain('### Change policy\n\nOpen a Plan before any production change.')
    expect(prompt).toContain('### Answer style\n\nLead with the answer.')
  })
}

test('another member of the team does not receive personal instructions', async () => {
  const prompt = await buildPreviewSystemPrompt({
    userId: 'user-2',
    teamId: TEAM_ID.toHexString(),
    sessionId: 'conv-2',
    locale: 'en',
  })

  expect(prompt).toContain('### Change policy')
  expect(prompt).not.toContain('Answer style')
})

// A runtime restarts a live agent when its system prompt changes (#4083), so nothing that
// changes from turn to turn, such as the time, may be in it.
test('the same conversation and member get the same system prompt on every turn', async () => {
  const args = {
    userId: 'user-1',
    teamId: TEAM_ID.toHexString(),
    sessionId: 'conv-1',
    locale: 'en',
  }
  const first = await buildPreviewSystemPrompt(args)

  await new Promise((resolve) => setTimeout(resolve, 1_100))
  expect(await buildPreviewSystemPrompt(args)).toBe(first)
})

test("a new Task's prompt is the same before and after its first turn stores its record", async () => {
  const args = {
    userId: 'user-1',
    teamId: TEAM_ID.toHexString(),
    sessionId: 'new-task',
    locale: 'en',
  }

  taskRecord = null
  const first = await buildPreviewSystemPrompt(args)
  const firstMessage = 'Check the release notes and summarise them'

  taskRecord = {
    sessionId: 'new-task',
    userId: 'user-1',
    firstMessage,
    title: fallbackTitle(firstMessage),
  } as AgentConversation
  expect(await buildPreviewSystemPrompt(args)).toBe(first)
  taskRecord = null
})
