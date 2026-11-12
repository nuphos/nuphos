import { beforeEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { GitlabApiError } from '@/lib/byos/gitlab'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useByosAccount } from '@/lib/test/doubles/byos-account'
import { useByosGitlab } from '@/lib/test/doubles/byos-gitlab'
import { useIdentity } from '@/lib/test/doubles/identity'

import { resourceFinished } from './resource-recheck'
import { resourceCredentialAllowed } from './session-resource-lookup'
import {
  bindSessionResource,
  refreshSessionResource,
  sessionResourceInput,
} from './session-resources'

import type { AgentConversation } from './db'
import type { SessionResource } from './session-resources'
import type { GitlabBinding } from '@/models'

const teamId = new ObjectId().toHexString()
const bindingId = new ObjectId().toHexString()
const actor = { userId: 'owner', teamId, sessionId: 'session' }
let conversation: AgentConversation
let binding: Partial<GitlabBinding> | null
let paths: string[] = []
let mr: Record<string, unknown>
let lookupError: Error | null = null

useIdentity({ getTeamMembership: async () => ({ role: 'MEMBER' }) })
useByosAccount({ findGitlabBinding: async () => binding })
useAgentDb({
  getConversationBySessionId: async () => conversation,
  agentConversations: () => ({ updateOne: async () => ({ modifiedCount: 1 }) }),
})
useByosGitlab({
  apiRequest: <T>(_team: ObjectId, _binding: GitlabBinding, path: string): Promise<T> => {
    paths.push(path)

    return lookupError ? Promise.reject(lookupError) : Promise.resolve(mr as T)
  },
})
beforeEach(() => {
  paths = []
  lookupError = null
  binding = { id: new ObjectId(bindingId), hostUrl: 'https://gitlab.example.com' }
  mr = {
    iid: 42,
    project_id: 77,
    title: 'Verified MR',
    state: 'opened',
    draft: false,
    merged_at: null,
    web_url: 'https://gitlab.example.com/group/sub/app/-/merge_requests/42',
    references: { full: 'group/sub/app!42' },
  }
  conversation = {
    sessionId: 'session',
    userId: 'owner',
    teamId,
    generalAccess: 'none',
    linkedResources: [],
    credentialAccess: { gitlabBindingIds: [bindingId] },
  } as unknown as AgentConversation
})
const input = { provider: 'gitlab' as const, bindingId, project: 'group/sub/app', iid: 42 }
const parses = (extra: Record<string, unknown>) =>
  sessionResourceInput.safeParse({ ...input, ...extra }).success

test('a merge request links as a pull request named by GitLab', async () => {
  const linked = await bindSessionResource(actor, input)

  expect(linked).toMatchObject({
    provider: 'gitlab',
    key: `gitlab/${bindingId}/77/42`,
    resourceId: '77/42',
    repository: 'group/sub/app',
    number: 42,
    title: 'Verified MR',
    state: 'open',
    draft: false,
    url: 'https://gitlab.example.com/group/sub/app/-/merge_requests/42',
  })
  // The full path is one encoded project id, so it cannot reach another API path.
  expect(paths).toEqual(['/projects/group%2Fsub%2Fapp/merge_requests/42'])
})
test('GitLab states map onto the pull-request states', async () => {
  mr = { ...mr, state: 'merged', merged_at: '2026-11-01T00:00:00Z' }
  expect(await bindSessionResource(actor, input)).toMatchObject({
    state: 'merged',
    mergedAt: '2026-11-01T00:00:00Z',
  })
  mr = { ...mr, state: 'locked' }
  const locked = await bindSessionResource(actor, input)

  expect(locked.state).toBe('closed')
  expect(resourceFinished(locked)).toBe(true)
})
test('a stored merge request is looked up again by its project id', async () => {
  const stored: SessionResource = {
    id: 'link',
    key: `gitlab/${bindingId}/77/42`,
    provider: 'gitlab',
    integrationId: bindingId,
    resourceId: '77/42',
    repository: 'group/sub/app',
    number: 42,
    title: 'Old title',
    state: 'open',
    url: 'https://gitlab.example.com/group/sub/app/-/merge_requests/42',
    linkedAt: new Date().toISOString(),
  }

  expect((await refreshSessionResource(conversation, stored)).title).toBe('Verified MR')
  expect(paths).toEqual(['/projects/77/merge_requests/42'])
})
test('a merge request URL off the binding host is refused', async () => {
  mr = { ...mr, web_url: 'https://evil.invalid/group/sub/app/-/merge_requests/42' }
  await expect(bindSessionResource(actor, input)).rejects.toThrow('not found')
})
test('a missing merge request is not found, other failures are a lookup error', async () => {
  lookupError = new GitlabApiError(404, 'missing')
  await expect(bindSessionResource(actor, input)).rejects.toThrow('not found')
  lookupError = new GitlabApiError(500, 'down')
  await expect(bindSessionResource(actor, input)).rejects.toThrow('lookup failed')
})
test('unselected, disconnected or allow-listed bindings never reach GitLab', async () => {
  conversation.credentialAccess!.gitlabBindingIds = []
  await expect(bindSessionResource(actor, input)).rejects.toThrow('Select')
  conversation.credentialAccess!.gitlabBindingIds = [bindingId]
  binding = {
    id: new ObjectId(bindingId),
    hostUrl: 'https://gitlab.example.com',
    access: { memberAllowList: ['someone-else'], updatedAt: new Date(), updatedBy: 'admin' },
  }
  await expect(bindSessionResource(actor, input)).rejects.toThrow('Select')
  binding = null
  expect(
    await resourceCredentialAllowed(conversation, { provider: 'gitlab', integrationId: bindingId }),
  ).toBe(false)
  expect(paths).toEqual([])
})
test('input takes a project id or full path and nothing else', () => {
  expect(parses({ project: '77' })).toBe(true)
  expect(parses({ project: 'app' })).toBe(false)
  expect(parses({ project: 'group/app?x=1' })).toBe(false)
  expect(parses({ url: 'https://evil.invalid' })).toBe(false)
  expect(parses({ bindingId: 'not-an-id' })).toBe(false)
})
