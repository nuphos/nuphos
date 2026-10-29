import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'

import { agentConversations, getConversationBySessionId } from './db'
import { canManage, conversationAccess } from './db/access'
import { resolveResource } from './session-resource-lookup'
import { unlinkSessionThread } from './session-thread-resources'

import type { AgentConversation } from './db'
import type { PullHealth } from './github-pull-health'
import type { ResolvedResource } from './session-resource-lookup'

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
  /** Linear workflow state type (backlog, unstarted, started, completed, canceled, triage). */
  stateType?: string
  repository?: string
  number?: number
  /** What blocks an open PR, kept current by GitHub webhooks; null or absent when nothing does. */
  health?: PullHealth | null
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

export async function bindSessionResource(
  actor: ResourceActor,
  input: z.infer<typeof sessionResourceInput>,
) {
  const conversation = await resourceConversation(actor, true)
  const resolved = await resolveResource(conversation, actor.userId, input)
  const key = `${resolved.provider}/${resolved.integrationId}/${resolved.resourceId}`
  const existing = conversation.linkedResources?.find((resource) => resource.key === key)

  // Linking again is how a caller asks for current state when no webhook reached us.
  if (existing) return writeFreshResource(actor.sessionId, existing, resolved)
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
  await Promise.all([
    agentConversations().updateOne(
      { sessionId: actor.sessionId, teamId: actor.teamId },
      { $pull: { linkedResources: { id } } },
    ),
    unlinkSessionThread(actor.sessionId, id),
  ])

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

  return writeFreshResource(conversation.sessionId, resource, fresh)
}

async function writeFreshResource(
  sessionId: string,
  resource: SessionResource,
  fresh: ResolvedResource,
): Promise<SessionResource> {
  if (fresh.resourceId !== resource.resourceId)
    throw new AppError(409, 'resource_changed', 'Resource identity changed')
  await agentConversations().updateOne(
    { sessionId, 'linkedResources.id': resource.id },
    {
      $set: {
        'linkedResources.$.title': fresh.title,
        'linkedResources.$.state': fresh.state,
        'linkedResources.$.url': fresh.url,
        ...(fresh.stateType ? { 'linkedResources.$.stateType': fresh.stateType } : {}),
        ...('health' in fresh ? { 'linkedResources.$.health': fresh.health } : {}),
      },
    },
  )

  return { ...resource, ...fresh }
}
