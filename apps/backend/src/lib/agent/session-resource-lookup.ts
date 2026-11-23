import { ObjectId } from 'mongodb'

import { canPrincipalsUseAllowList } from '@/lib/byos/access'
import { findGithubInstallation, findGitlabBinding, findLinearWorkspace } from '@/lib/byos/account'
import { getInstallationToken } from '@/lib/byos/github'
import { GITHUB_API, githubFetch } from '@/lib/byos/github-http'
import { GitlabApiError, apiRequest as gitlabApi } from '@/lib/byos/gitlab'
import { linearGraphql } from '@/lib/byos/linear'
import { withLinearAccessToken } from '@/lib/byos/linear-tokens'
import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'
import { logEvent } from '@/lib/observability'

import { agentConversations, credentialSource } from './db'
import { resolveGithubIssue } from './github-issue-lookup'
import { readPull } from './github-pull-health'
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
  const { credentialAccess: access } = await credentialSource(conversation)
  const selected = {
    github: access?.githubInstallationIds,
    gitlab: access?.gitlabBindingIds,
    linear: access?.linearWorkspaceIds,
  }[resource.provider]

  if (!selected?.includes(resource.integrationId)) return false
  const binding = await findResourceBinding(new ObjectId(conversation.teamId), resource)

  return Boolean(
    binding &&
    canPrincipalsUseAllowList(binding.access?.memberAllowList, [actorId, conversation.userId]),
  )
}

/**
 * The conversations linking `key` that may still read it. A webhook writes
 * fresh state only to these, so a member taken off the integration's list
 * stops receiving it.
 */
export async function allowedResourceRecipients(key: string): Promise<ObjectId[]> {
  const ids: ObjectId[] = []

  for await (const conversation of agentConversations().find({ 'linkedResources.key': key })) {
    const resource = conversation.linkedResources?.find((entry) => entry.key === key)

    if (conversation._id && resource && (await resourceCredentialAllowed(conversation, resource)))
      ids.push(conversation._id)
  }

  return ids
}

function findResourceBinding(
  team: ObjectId,
  { provider, integrationId }: Pick<SessionResource, 'provider' | 'integrationId'>,
) {
  if (provider === 'github') return findGithubInstallation(team, Number(integrationId))
  const id = new ObjectId(integrationId)

  return provider === 'gitlab' ? findGitlabBinding(team, id) : findLinearWorkspace(team, id)
}

function inputIntegrationId(input: z.infer<typeof sessionResourceInput>) {
  if (input.provider === 'github') return String(input.installationId)

  return input.provider === 'gitlab' ? input.bindingId : input.workspaceId
}

export async function resolveResource(
  conversation: AgentConversation,
  actorId: string,
  input: z.infer<typeof sessionResourceInput>,
  /** What a stored link already knows: a known issue skips the pull request lookup. */
  known: Pick<SessionResource, 'kind'> = {},
): Promise<ResolvedResource> {
  const integrationId = inputIntegrationId(input)

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
    const { token } = await getInstallationToken(input.installationId)

    if (known.kind === 'issue')
      return resolveGithubIssue(input, integrationId, token, githubLookupError)
    const response = await githubFetch(
      `${GITHUB_API}/repos/${input.repository}/pulls/${input.number}`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      },
    )

    // An issue's number is not a pull request's: GitHub answers 404 there.
    if (response.status === 404)
      return resolveGithubIssue(input, integrationId, token, githubLookupError)
    if (!response.ok) throw githubLookupError(response, input.repository, input.number)
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

    const repository = pr.base.repo.full_name
    const health = await readPull(input.installationId, repository, pr.number, pr).then(
      (read) => read?.health ?? null,
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

  if (input.provider === 'gitlab') return resolveMergeRequest(team, input)
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

/**
 * Why GitHub refused a pull request lookup, in words the agent can act on.
 * GitHub answers 403 both for a spent quota and for a denial; the rate-limit
 * headers tell them apart.
 */
function githubLookupError(response: Response, repository: string, number: number) {
  const header = (name: string) => response.headers.get(name) ?? undefined
  const remaining = header('x-ratelimit-remaining')
  const reset = header('x-ratelimit-reset')
  const retryAfter = header('retry-after')

  logEvent('warn', 'github.resource.lookup_failed', {
    status: response.status,
    rateLimitRemaining: remaining,
    rateLimitReset: reset,
    rateLimitResource: header('x-ratelimit-resource'),
    retryAfter,
  })
  if (response.status === 429 || (response.status === 403 && (remaining === '0' || retryAfter))) {
    let when = 'the hourly reset'

    if (retryAfter) when = `${retryAfter} seconds`
    else if (reset) when = `${new Date(Number(reset) * 1000).toISOString().slice(11, 16)} UTC`

    return new AppError(
      429,
      'github_rate_limited',
      `GitHub API rate limit reached for this App installation; retry after ${when}`,
    )
  }
  if (response.status === 403)
    return new AppError(
      403,
      'forbidden',
      `The GitHub App installation has no access to ${repository}; grant it the repository and pull request read permission`,
    )
  if (response.status === 404)
    return new AppError(
      404,
      'not_found',
      `${repository}#${String(number)} was not found, or the GitHub App installation cannot see ${repository}`,
    )

  return new AppError(502, 'resource_lookup_failed', `GitHub returned ${String(response.status)}`)
}

type GitlabInput = Extract<z.infer<typeof sessionResourceInput>, { provider: 'gitlab' }>

/** A GitLab merge request, in the pull-request words the tags already use. */
async function resolveMergeRequest(team: ObjectId, input: GitlabInput): Promise<ResolvedResource> {
  const binding = await findGitlabBinding(team, new ObjectId(input.bindingId))

  if (!binding) throw new AppError(404, 'not_found', 'GitLab binding was disconnected')
  const mr = await gitlabApi<{
    iid: number
    project_id: number
    title: string
    state: 'opened' | 'closed' | 'merged' | 'locked'
    draft?: boolean
    merged_at?: string | null
    web_url: string
    references?: { full?: string }
  }>(
    team,
    binding,
    `/projects/${encodeURIComponent(input.project)}/merge_requests/${String(input.iid)}`,
  ).catch((error: unknown) => {
    if (error instanceof GitlabApiError && error.status === 404)
      throw new AppError(404, 'not_found', 'GitLab merge request not found')
    throw new AppError(502, 'resource_lookup_failed', 'GitLab merge request lookup failed')
  })

  if (!mr.web_url.startsWith(`${binding.hostUrl}/`))
    throw new AppError(404, 'not_found', 'GitLab merge request not found')
  const mergedAt = mergedAtOf(mr.merged_at)
  const stateWords = { opened: 'open', merged: 'merged', closed: 'closed', locked: 'closed' }

  return {
    provider: 'gitlab',
    integrationId: input.bindingId,
    resourceId: `${String(mr.project_id)}/${String(mr.iid)}`,
    repository: mr.references?.full?.replace(/!\d+$/, ''),
    number: mr.iid,
    title: mr.title.slice(0, 300),
    state: stateWords[mr.state],
    url: mr.web_url,
    draft: Boolean(mr.draft),
    ...(mergedAt ? { mergedAt } : {}),
  }
}
