import { ObjectId } from 'mongodb'

import { canUseAllowList } from '@/lib/byos/access'
import { findGithubInstallation, findLinearWorkspace } from '@/lib/byos/account'
import { getInstallationToken } from '@/lib/byos/github'
import { GITHUB_API, githubFetch } from '@/lib/byos/github-http'
import { linearGraphql } from '@/lib/byos/linear'
import { withLinearAccessToken } from '@/lib/byos/linear-tokens'
import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'

import { fetchPullHealth } from './github-pull-health'
import { githubReviewScope } from './github-review-scope'
import { mergedAtOf } from './merged-at'

import type { AgentConversation } from './db'
import type { SessionResource, sessionResourceInput } from './session-resources'
import type { z } from 'zod'

/** What a provider says about a resource now, before it is linked. */
export type ResolvedResource = Omit<SessionResource, 'id' | 'key' | 'linkedAt'>

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

export async function resolveResource(
  conversation: AgentConversation,
  actorId: string,
  input: z.infer<typeof sessionResourceInput>,
): Promise<ResolvedResource> {
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
      draft?: boolean
      merged_at?: string | null
      mergeable_state?: string | null
      head: { sha: string }
      base: { repo: { id: number; full_name: string } }
    }

    const mergedAt = mergedAtOf(pr.merged_at)

    if (scope && scope.repositoryId !== pr.base.repo.id)
      throw new AppError(403, 'github_review_scope', 'Resource is outside the review repository')
    const repository = pr.base.repo.full_name
    const health = await fetchPullHealth(input.installationId, repository, pr.number, pr).catch(
      () => null,
    )

    return {
      provider: 'github',
      integrationId,
      resourceId: `${pr.base.repo.id}/${pr.number}`,
      repository,
      number: pr.number,
      title: pr.title.slice(0, 300),
      state: pr.merged ? 'merged' : pr.state,
      url: `https://github.com/${repository}/pull/${pr.number}`,
      health,
      draft: Boolean(pr.draft),
      ...(mergedAt ? { mergedAt } : {}),
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
        state: { name: string; type: string }
      } | null
    }>(token, 'query($id:String!){issue(id:$id){id identifier title url state{name type}}}', {
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
    stateType: issue.state.type,
  }
}
