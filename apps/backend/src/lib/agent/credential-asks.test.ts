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
        const listed = 'inputRequests.id' in filter

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

  // An exact own credential: only selecting that one answers it, never a team binding.
  const personal = (id: 'github' | 'linear'): InputRequest => ({
    ...ask('q'),
    credentials: [{ provider: 'personal', id }],
  })

  test("a team binding never answers a question for the member's own credential", () => {
    expect(selectedProviders(personal('github'), { githubInstallationIds: ['1', '2'] })).toEqual([])
    expect(selectedProviders(personal('linear'), { linearWorkspaceIds: ['w'] })).toEqual([])
  })

  test('selecting the own credential it names answers it; another one does not', () => {
    expect(selectedProviders(personal('github'), { personalCredentialIds: ['github'] })).toEqual([
      'personal github',
    ])
    expect(selectedProviders(personal('github'), { personalCredentialIds: ['linear'] })).toEqual([])
  })

  test('a question for any GitHub access is still answered by a team installation', () => {
    expect(selectedProviders(ask('q', ['github']), { githubInstallationIds: ['1'] })).toEqual([
      'github',
    ])
  })

  test('a question without providers is never answered by a selection', () => {
    expect(selectedProviders(ask('q'), { githubInstallationIds: ['1'] })).toEqual([])
  })
})

describe('answerCredentialAsks', () => {
  test('answers the question that asked for the provider and resumes the agent', async () => {
    await answerCredentialAsks('s1', { personalCredentialIds: ['github'] })

    expect(resolved).toHaveLength(1)
    expect(resolved[0]).toMatchObject({ $pull: { inputRequests: { id: expect.any(String) } } })
    expect(turns).toHaveLength(1)
    expect(turns[0]!.sessionId).toBe('s1')
    expect(turns[0]!.text).toContain('q-github')
    expect(turns[0]!.text).toContain('github')
  })

  test('selecting Trello answers its exact request and resumes the asking conversation', async () => {
    conversation!.inputRequests = [ask('q-trello', ['trello']), ask('q-github', ['github'])]

    await answerCredentialAsks(
      's1',
      addedCredentialIds(
        { trelloIntegrationIds: [] },
        { trelloIntegrationIds: ['trello-account'] },
      ),
    )

    expect(resolved).toHaveLength(1)
    expect(resolved[0]).toMatchObject({ $pull: { inputRequests: { id: expect.any(String) } } })
    expect(turns).toHaveLength(1)
    expect(turns[0]!.sessionId).toBe('s1')
    expect(turns[0]!.text).toContain('q-trello')
    expect(turns[0]!.text).not.toContain('q-github')
  })

  test("with the team's GitHub already selected, opting into one's own answers the session's ask", async () => {
    // What the Inbox's own-GitHub pick sends: the stored installation kept, the personal credential added.
    const stored = { githubInstallationIds: ['166'] }
    const saved = { githubInstallationIds: ['166'], personalCredentialIds: ['github' as const] }

    await answerCredentialAsks('s1', addedCredentialIds(stored, saved))

    expect(resolved).toHaveLength(1)
    expect(turns.map((turn) => turn.sessionId)).toEqual(['s1'])
  })

  test("acting as the member on the team's installation (teamIdentity) answers no ask", async () => {
    const stored = { githubInstallationIds: ['166'], teamIdentity: ['github' as const] }
    const saved = { githubInstallationIds: ['166'], teamIdentity: [] }

    await answerCredentialAsks('s1', addedCredentialIds(stored, saved))

    expect(resolved).toEqual([])
    expect(turns).toEqual([])
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
