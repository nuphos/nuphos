import { parseInfraContext } from './url-context-infra'
import { baseContext, compactPath, joinView, pathSegments } from './url-context-shared'

import type { UrlContext } from './url-context-shared'

export { urlContextSchema } from './url-context-shared'
export type { UrlContext } from './url-context-shared'

function parseTeamContext(
  currentUrl: string,
  searchParams: URLSearchParams | undefined,
  teamId: string,
  rest: string[],
): UrlContext {
  const section = rest[0]

  if (!section) {
    return { ...baseContext(currentUrl, searchParams), pageType: 'team', teamId }
  }

  if (section === 'agent') {
    return {
      ...baseContext(currentUrl, searchParams),
      pageType: rest[1] === 'memories' ? 'agent-memories' : 'agent',
      teamId,
      resourceKind: rest[1] && rest[1] !== 'memories' ? 'agent-session' : undefined,
      resourceId: rest[1] && rest[1] !== 'memories' ? rest[1] : undefined,
      view: rest[1] ?? 'chat',
    }
  }

  if (section === 'plans') {
    return {
      ...baseContext(currentUrl, searchParams),
      pageType: 'plans',
      teamId,
      resourceKind: rest[1] ? 'plan' : undefined,
      resourceId: rest[1],
      view: rest[1] ? 'detail' : 'list',
    }
  }

  if (section === 'settings') {
    const integrationId = rest[1] === 'integrations' ? rest[2] : undefined

    return {
      ...baseContext(currentUrl, searchParams),
      pageType: 'settings',
      teamId,
      parentId: integrationId,
      resourceId: rest.at(-1),
      view: joinView(rest.slice(1)) ?? 'settings',
    }
  }

  // The connectors page (formerly /settings/integrations): /teams/T/connectors/<parent>/...
  if (section === 'connectors') {
    return {
      ...baseContext(currentUrl, searchParams),
      pageType: 'settings',
      teamId,
      parentId: rest[1],
      resourceId: rest.at(-1),
      view: joinView(rest.slice(1)) ?? 'connectors',
    }
  }

  if (section === 'observability') {
    return {
      ...baseContext(currentUrl, searchParams),
      pageType: 'observability',
      teamId,
      grafanaInstanceId: rest[1] === 'grafana' ? rest[2] : undefined,
      resourceKind: rest[3],
      resourceId: rest[4],
      view: joinView(rest.slice(1)) ?? 'home',
    }
  }

  if (section === 'repository') {
    const repoIndex = rest.indexOf('repos')

    return {
      ...baseContext(currentUrl, searchParams),
      pageType: 'repository',
      teamId,
      installationId: rest[1] === 'installations' ? rest[2] : undefined,
      owner: repoIndex >= 0 ? rest[repoIndex + 1] : undefined,
      repo: repoIndex >= 0 ? rest[repoIndex + 2] : undefined,
      resourceKind: repoIndex >= 0 ? rest[repoIndex + 3] : undefined,
      resourceId: repoIndex >= 0 ? rest[repoIndex + 4] : undefined,
      view: joinView(rest.slice(1)) ?? 'home',
    }
  }

  return {
    ...baseContext(currentUrl, searchParams),
    pageType: 'team',
    teamId,
    view: joinView(rest),
  }
}

export function parseUrlContext(url: string, searchParams?: URLSearchParams): UrlContext {
  const cleanUrl = compactPath(url)
  const segments = pathSegments(cleanUrl)

  if (segments.length === 0) {
    return { ...baseContext(url, searchParams), pageType: 'home' }
  }
  if (segments[0] !== 'teams') {
    return { ...baseContext(url, searchParams), pageType: 'other', view: joinView(segments) }
  }
  if (!segments[1]) {
    return { ...baseContext(url, searchParams), pageType: 'teams' }
  }

  const teamId = segments[1]
  const rest = segments.slice(2)
  const infra = rest[0] === 'infra' ? parseInfraContext(url, searchParams, teamId, rest) : null

  if (infra) return infra

  // Legacy routes kept for old persisted conversation URLs and external links.
  if (rest[0] === 'aws' && rest[1]) {
    return {
      ...baseContext(url, searchParams),
      pageType: 'aws-account',
      teamId,
      provider: 'aws',
      awsAccountId: rest[1],
      parentId: rest[1],
      parentKind: 'aws-account',
      view: joinView(rest.slice(2)) ?? 'overview',
    }
  }
  if (rest[0] === 'gcp' && rest[1]) {
    return {
      ...baseContext(url, searchParams),
      pageType: 'gcp-project',
      teamId,
      provider: 'gcp',
      gcpProjectId: rest[1],
      parentId: rest[1],
      parentKind: 'gcp-project',
      view: joinView(rest.slice(2)) ?? 'overview',
    }
  }
  if (rest[0] === 'clusters' && rest[1]) {
    return {
      ...baseContext(url, searchParams),
      pageType: 'cluster',
      teamId,
      clusterId: rest[1],
      clusterName: rest[1],
      view: joinView(rest.slice(2)) ?? 'overview',
    }
  }

  return parseTeamContext(url, searchParams, teamId, rest)
}

export async function generateContextPrompt(urlContext: UrlContext): Promise<string> {
  const entries = Object.entries<string | undefined>(urlContext).filter(
    ([, value]) => value !== undefined && value !== '',
  )
  const lines = entries.map(([key, value]) => `- ${key}: ${String(value)}`)

  return [
    '## Current Nuphos page context',
    '',
    'The user opened this agent chat from a Nuphos desktop page. Treat these fields as the default scope for read-only inspection, API calls, cloud credentials, Kubernetes context, and Nuphos GUI links unless the user explicitly redirects you.',
    '',
    ...lines,
    '',
    'For Nuphos GUI markdown links, do not guess route templates. Search `skills/nuphos-api/references/gui-routes.md` with `rg -i "<resource keyword>"` and use the matching row only when all required ids are available. The context above can supply defaults such as teamId, accountId/projectId, provider, clusterName, region, namespace, and view.',
  ].join('\n')
}
