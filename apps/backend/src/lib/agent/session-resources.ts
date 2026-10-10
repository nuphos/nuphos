import { randomUUID } from 'node:crypto'

import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { canUseAllowList } from '@/lib/byos/access'
import { findGithubInstallation, findLinearWorkspace } from '@/lib/byos/account'
import { getInstallationToken } from '@/lib/byos/github'
import { GITHUB_API, githubFetch } from '@/lib/byos/github-http'
import { linearGraphql } from '@/lib/byos/linear'
import { withLinearAccessToken } from '@/lib/byos/linear-tokens'
import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'

import { agentConversations, getConversationBySessionId } from './db'
import { canManage, conversationAccess } from './db/access'
import { githubReviewScope } from './github-review-scope'

import type { AgentConversation } from './db'

export const sessionResourceInput = z.discriminatedUnion('provider', [
  z
    .object({
      provider: z.literal('github'),
      installationId: z.number().int().positive(),
      repository: z
        .string()
        .regex(/^[\w.-]+\/[\w.-]+$/)
        .max(200),
      number: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      provider: z.literal('linear'),
      workspaceId: z.string().regex(/^[a-f\d]{24}$/i),
      issueId: z.string().min(1).max(100),
    })
    .strict(),
])

export type SessionResource = {
  id: string
  key: string
  provider: 'github' | 'linear'
  integrationId: string
  resourceId: string
  title: string
  url: string
  state: string
  repository?: string
  number?: number
  linkedAt: string
}
export type ResourceActor = { userId: string; teamId: string; sessionId: string }

export async function resourceConversation(actor: ResourceActor, manage = false) {
  const conversation = await getConversationBySessionId(actor.sessionId)

  if (
    !conversation ||
    conversation.teamId !== actor.teamId ||
    !(await getTeamMembership(actor.userId, actor.teamId)) ||
    !conversationAccess(conversation, actor.userId)
  ) {
    throw new AppError(404, 'not_found', 'Conversation not found')
  }
  if (
    manage &&
    (!canManage(conversationAccess(conversation, actor.userId)) || conversation.archivedAt)
  ) {
    throw new AppError(
      403,
      'forbidden',
      'Only an active conversation owner or manager can change resource bindings',
    )
  }

  return conversation
}

export async function resourceCredentialAllowed(
  conversation: AgentConversation,
  resource: Pick<SessionResource, 'provider' | 'integrationId'>,
  actorId = conversation.userId,
) {
  if (!conversation.teamId || !(await getTeamMembership(conversation.userId, conversation.teamId)))
    return false
  const team = new ObjectId(conversation.teamId)

  if (resource.provider === 'github') {
    return Boolean(
      conversation.credentialAccess?.githubInstallationIds?.includes(resource.integrationId) &&
      (await findGithubInstallation(team, Number(resource.integrationId))),
    )
  }
  if (!conversation.credentialAccess?.linearWorkspaceIds?.includes(resource.integrationId))
    return false
  const binding = await findLinearWorkspace(team, new ObjectId(resource.integrationId))

  return Boolean(
    binding &&
    canUseAllowList(binding.access?.memberAllowList, actorId) &&
    canUseAllowList(binding.access?.memberAllowList, conversation.userId),
  )
}

async function resolveResource(
  conversation: AgentConversation,
  actorId: string,
  input: z.infer<typeof sessionResourceInput>,
): Promise<Omit<SessionResource, 'id' | 'key' | 'linkedAt'>> {
  const integrationId =
    input.provider === 'github' ? String(input.installationId) : input.workspaceId

  if (
    !(await resourceCredentialAllowed(
      conversation,
      { provider: input.provider, integrationId },
      actorId,
    ))
  ) {
    throw new AppError(
      403,
      'credential_not_selected',
      'Select an accessible integration for this conversation first',
    )
  }
  if (input.provider === 'github') {
    const scope = await githubReviewScope(conversation.sessionId, conversation.teamId!)

    if (scope && scope.installationId !== input.installationId) {
      throw new AppError(403, 'github_review_scope', 'Resource is outside the review repository')
    }
    const { token } = await getInstallationToken(input.installationId, scope?.repositoryId)
    const response = await githubFetch(
      `${GITHUB_API}/repos/${input.repository}/pulls/${input.number}`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      },
    )

    if (!response.ok)
      throw new AppError(502, 'resource_lookup_failed', `GitHub returned ${response.status}`)
    const pr = (await response.json()) as {
      number: number
      title: string
      state: string
      merged: boolean
      base: { repo: { id: number; full_name: string } }
    }

    if (scope && scope.repositoryId !== pr.base.repo.id)
      throw new AppError(403, 'github_review_scope', 'Resource is outside the review repository')
    const repository = pr.base.repo.full_name

    return {
      provider: 'github',
      integrationId,
      resourceId: `${pr.base.repo.id}/${pr.number}`,
      repository,
      number: pr.number,
      title: pr.title.slice(0, 300),
      state: pr.merged ? 'merged' : pr.state,
      url: `https://github.com/${repository}/pull/${pr.number}`,
    }
  }
  const team = new ObjectId(conversation.teamId!)
  const binding = await findLinearWorkspace(team, new ObjectId(input.workspaceId))

  if (!binding) throw new AppError(404, 'not_found', 'Linear workspace was disconnected')
  const result = await withLinearAccessToken(team, binding, (token) =>
    linearGraphql<{
      issue: {
        id: string
        identifier: string
        title: string
        url: string
        state: { name: string }
      } | null
    }>(token, 'query($id:String!){issue(id:$id){id identifier title url state{name}}}', {
      id: input.issueId,
    }),
  )
  const issue = result.issue

  if (!issue?.url.startsWith('https://linear.app/'))
    throw new AppError(404, 'not_found', 'Linear issue not found')

  return {
    provider: 'linear',
    integrationId,
    resourceId: issue.id,
    title: `${issue.identifier} ${issue.title}`.slice(0, 300),
    url: issue.url,
    state: issue.state.name,
  }
}

export async function bindSessionResource(
  actor: ResourceActor,
  input: z.infer<typeof sessionResourceInput>,
) {
  const conversation = await resourceConversation(actor, true)
  const resolved = await resolveResource(conversation, actor.userId, input)
  const key = `${resolved.provider}/${resolved.integrationId}/${resolved.resourceId}`
  const existing = conversation.linkedResources?.find((resource) => resource.key === key)

  if (existing) return existing
  const resource: SessionResource = {
    ...resolved,
    key,
    id: randomUUID(),
    linkedAt: new Date().toISOString(),
  }
  const result = await agentConversations().updateOne(
    {
      sessionId: actor.sessionId,
      teamId: actor.teamId,
      archivedAt: { $exists: false },
      'linkedResources.key': { $ne: key },
      $expr: { $lt: [{ $size: { $ifNull: ['$linkedResources', []] } }, 50] },
    },
    { $push: { linkedResources: resource } },
  )

  if (!result.modifiedCount) {
    const current = await resourceConversation(actor, true)
    const duplicate = current.linkedResources?.find((entry) => entry.key === key)

    if (duplicate) return duplicate
    throw new AppError(409, 'resource_limit', 'A conversation can link at most 50 resources')
  }

  return resource
}

export async function unlinkSessionResource(actor: ResourceActor, id: string) {
  await resourceConversation(actor, true)
  await agentConversations().updateOne(
    { sessionId: actor.sessionId, teamId: actor.teamId },
    { $pull: { linkedResources: { id } } },
  )

  return { ok: true }
}

export async function refreshSessionResource(
  conversation: AgentConversation,
  resource: SessionResource,
) {
  const input =
    resource.provider === 'github'
      ? {
          provider: 'github' as const,
          installationId: Number(resource.integrationId),
          repository: resource.repository!,
          number: resource.number!,
        }
      : {
          provider: 'linear' as const,
          workspaceId: resource.integrationId,
          issueId: resource.resourceId,
        }
  const fresh = await resolveResource(conversation, conversation.userId, input)

  if (fresh.resourceId !== resource.resourceId)
    throw new AppError(409, 'resource_changed', 'Resource identity changed')
  await agentConversations().updateOne(
    { sessionId: conversation.sessionId, 'linkedResources.id': resource.id },
    {
      $set: {
        'linkedResources.$.title': fresh.title,
        'linkedResources.$.state': fresh.state,
        'linkedResources.$.url': fresh.url,
      },
    },
  )

  return { ...resource, ...fresh }
}
