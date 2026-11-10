import { beforeEach, describe, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useConversationTurn } from '@/lib/test/doubles/conversation-turn'
import { useDb } from '@/lib/test/doubles/db'

import type { AgentConversation } from './db'
import type { InputRequest } from './db/pending-decision'
import type * as dbActual from '@/lib/db'

const turns: { sessionId: string; text: string }[] = []
const resolved: unknown[] = []
// Whether the store still holds the question open, so this call resolves it.
let stillOpen = true
let conversation: Partial<AgentConversation> | null = null

useConversationTurn({
  startConversationTurn: (data, _target, text) => {
    turns.push({ sessionId: data.targetSessionId, text })

    return Promise.resolve({ status: 'started' as const, run: Promise.resolve(undefined) })
  },
})
useAgentDb({
  getConversationBySessionId: async () => conversation,
})
useDb({
  db: () => ({
    collection: () => ({
      updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
        const listed = 'inputRequests' in filter

        if (listed && stillOpen) resolved.push(update)

        return { matchedCount: listed && stillOpen ? 1 : 0 }
      },
    }),
  }),
})

const { addedCredentialIds, answerCredentialAsks, selectedProviders } =
  await import('./credential-asks')

const ask = (id: string, providers?: string[]): InputRequest => ({
  id,
  category: providers ? 'integration' : 'preference',
  question: 'Need access',
  ...(providers ? { providers } : {}),
  askedAt: new Date('2026-11-10T00:00:00Z'),
  status: 'open',
})

beforeEach(() => {
  turns.length = 0
  resolved.length = 0
  stillOpen = true
  conversation = {
    sessionId: 's1',
    userId: 'owner',
    teamId: 't1',
    inputRequests: [ask('q-github', ['github']), ask('q-text')],
  }
})

describe('addedCredentialIds', () => {
  test('keeps only ids the selection did not have', () => {
    expect(
      addedCredentialIds(
        { githubInstallationIds: ['1'], awsRoleIds: ['a'] },
        { githubInstallationIds: ['1', '2'], awsRoleIds: ['a'], updatedAt: new Date() },
      ),
    ).toEqual({ githubInstallationIds: ['2'] })
  })

  test('counts every id when there was no selection before', () => {
    expect(addedCredentialIds(undefined, { linearWorkspaceIds: ['w'] })).toEqual({
      linearWorkspaceIds: ['w'],
    })
  })
})

describe('selectedProviders', () => {
  test('a team connector answers the provider whose field gained an id', () => {
    expect(selectedProviders(ask('q', ['github', 'aws']), { awsRoleIds: ['r'] })).toEqual(['aws'])
  })

  test('a personal credential answers the provider it is named after', () => {
    expect(selectedProviders(ask('q', ['github']), { personalCredentialIds: ['github'] })).toEqual([
      'github',
    ])
    expect(selectedProviders(ask('q', ['github']), { personalCredentialIds: ['linear'] })).toEqual(
      [],
    )
  })

  test('a question without providers is never answered by a selection', () => {
    expect(selectedProviders(ask('q'), { githubInstallationIds: ['1'] })).toEqual([])
  })
})

describe('answerCredentialAsks', () => {
  test('answers the question that asked for the provider and resumes the agent', async () => {
    await answerCredentialAsks('s1', { personalCredentialIds: ['github'] })

    expect(resolved).toHaveLength(1)
    expect(resolved[0]).toMatchObject({ $set: { 'inputRequests.$.status': 'answered' } })
    expect(turns).toHaveLength(1)
    expect(turns[0]!.sessionId).toBe('s1')
    expect(turns[0]!.text).toContain('q-github')
    expect(turns[0]!.text).toContain('github')
  })

  test('another provider leaves the question open and the agent idle', async () => {
    await answerCredentialAsks('s1', { awsRoleIds: ['r'] })

    expect(resolved).toEqual([])
    expect(turns).toEqual([])
  })

  test('a question someone else already resolved does not wake the agent again', async () => {
    stillOpen = false
    await answerCredentialAsks('s1', { githubInstallationIds: ['1'] })

    expect(turns).toEqual([])
  })
})
