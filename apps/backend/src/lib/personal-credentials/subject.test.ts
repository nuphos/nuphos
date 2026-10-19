import { beforeEach, describe, expect, test } from 'bun:test'

import { mintPreviewMcpToken } from '@/lib/claude-code-preview/mcp-token'
import { useAgentDb } from '@/lib/test/doubles/agent-db'

import { personalCredentialSubjectFor } from './handout'

import type { AgentConversation } from '@/lib/agent/db'

let teamIdentity: ('github' | 'linear')[] | undefined

useAgentDb({
  getConversationBySessionId: (sessionId: string) =>
    Promise.resolve(
      sessionId === 'conv-1'
        ? ({ sessionId, credentialAccess: { teamIdentity } } as unknown as AgentConversation)
        : null,
    ),
})

/** A turn in conv-1, owned by `owner`. */
const turn = (actor: string, humanTurn: boolean) =>
  `Bearer ${mintPreviewMcpToken({
    userId: actor,
    conversationOwnerUserId: 'owner',
    sessionId: 'conv-1',
    teamId: 'team-1',
    humanTurn,
  })}`

beforeEach(() => {
  teamIdentity = undefined
})

describe('personalCredentialSubjectFor', () => {
  test('uses the member’s Personal Credential unless the conversation picks the team', async () => {
    expect(await personalCredentialSubjectFor('github', turn('owner', true))).toBe('owner')
    expect(await personalCredentialSubjectFor('github', turn('teammate', true))).toBe('teammate')
    expect(await personalCredentialSubjectFor('linear', turn('owner', false))).toBe('owner')
  })

  test('the conversation’s team identity applies to member and automated turns alike', async () => {
    teamIdentity = ['github']

    expect(await personalCredentialSubjectFor('github', turn('owner', true))).toBeNull()
    expect(await personalCredentialSubjectFor('github', turn('owner', false))).toBeNull()
    expect(await personalCredentialSubjectFor('github', turn('teammate', true))).toBeNull()
    // Per provider: Linear still acts as the member.
    expect(await personalCredentialSubjectFor('linear', turn('owner', false))).toBe('owner')
  })

  test('the agent’s explicit team request still wins', async () => {
    expect(await personalCredentialSubjectFor('github', turn('owner', true), 'team')).toBeNull()
  })
})
