import '@/routes/agent'

import { expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useModels } from '@/lib/test/doubles/models'
import { createFakeInstructionsCollection } from '@/lib/test/fake-instructions-collection'

const TEAM_ID = new ObjectId()
const collection = createFakeInstructionsCollection()

useModels({ agentInstructions: () => collection })

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
