import assert from 'node:assert/strict'
import test from 'node:test'

import { agentAvatarPick } from '../lib/agentAvatarChoices.ts'

import { channelsApi } from './channels-api.ts'

test("a chat's agents lend their faces to posts, whoever owns the Bot", async () => {
  ;(globalThis as { window?: unknown }).window = {
    api: {
      agentListChannelAgents: async () => ({
        agents: [{ sessionId: 'teammates-bot', title: '書記官', ownerId: 'b', avatar: '07-ada' }],
      }),
    },
  }

  assert.equal(agentAvatarPick('teammates-bot'), undefined)
  await channelsApi.agentListChannelAgents('chat', 'team')
  assert.equal(agentAvatarPick('teammates-bot'), '07-ada')
})
