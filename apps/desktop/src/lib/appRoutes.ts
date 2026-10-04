// The single source of truth for the app's URL vocabulary — the producer
// (`pageLocationForNavigation`) and parser (`navigationFromAppPath`) live here
// and nowhere else. A provider section page is one PROVIDER_SECTIONS row that
// serves both directions; appRoutes.test.ts locks produce∘parse∘produce as a
// fixed point over the route table.
//
// Runtime imports must stay free of React so this module remains loadable under
// plain `node --test` (no JSX).
import { parseDashboardViewRange } from '../dashboards/view/range.ts'

import { kubernetesNavigation } from './app-routes/clusterParse.ts'
import { linearNavigation } from './app-routes/linearParse.ts'
import {
  emptyNavigation,
  githubInstallationFromId,
  githubRepositoryFromPath,
  splitAppPath,
} from './app-routes/parseShared.ts'
import { pageLocationForNavigation } from './app-routes/producer.ts'
import { connectorsNavigation, infraNavigation } from './app-routes/providerParse.ts'

import type { Scope } from '../types'
import type { NavigationSnapshot } from './app-routes/types.ts'
import type { GithubPRState } from '../views/GithubRepoDetailView'

export { detailKindFromUrlSegment, activeKeyForDetailKind } from './app-routes/detailKinds.ts'
export { pageLocation, pathSegment } from './app-routes/sections.ts'
export {
  CLOUDFLARE_DETAIL_ACTIVE,
  CONNECTOR_INFO_LABELS,
  CONNECTOR_INFO_PROVIDERS,
  DEFAULT_GITHUB_NAV,
  DEFAULT_KEY,
  DEFAULT_REPO_PROVIDER,
} from './app-routes/types.ts'
export {
  emptyNavigation,
  githubInstallationFromId,
  githubRepositoryFromPath,
  pageLocationForNavigation,
}
export type {
  AwsResourceDetailRef,
  AwsS3Detail,
  CloudflareResourceDetailRef,
  ConnectorDetailRef,
  ConnectorInfoProvider,
  LinearNavState,
  LinearTeamRef,
  NuphosDashboardRef,
  GrafanaSelection,
  NavigationSnapshot,
  PageLocation,
  RepoProvider,
  SshTerminalLocation,
  TriggerFormRef,
} from './app-routes/types.ts'

/**
 * Parse an in-app path (or full nuphos.ai URL) into a NavigationSnapshot.
 *
 * Covers every path `pageLocationForNavigation` can emit, plus legacy inbound
 * aliases (/settings, /settings/integrations/…, pre-rename provider segments).
 * Names the URL doesn't carry (diagram titles, Grafana instance names, GitHub
 * repo metadata, …) are stubbed and refined by the view after load — same
 * contract as navigationFromMentionTarget.
 */
/**
 * Path segments that follow `/teams/<id>/agent/` and are *pages*, not agent
 * session ids. Anything not listed here is read as a session id — by this
 * parser and, more importantly, by the mention parser in `atlasLinkMention`,
 * which sees these links first. A page added below without being added here
 * would resolve to the Agent page instead (that bug shipped once for Skills).
 */
export const AGENT_SUBPAGE_SEGMENTS = new Set(['memories', 'skills', 'archived'])

/**
 * True when `path` is a page's bare address — it carries no navigation state
 * beyond the page itself. A chat (`/agent/<sessionId>`) and a filtered view
 * (`/agent/skills/<name>`) are not bare even though their `active` key is the
 * same as the section page's. Callers pair this with their own notion of which
 * pages are permanent sidebar rows.
 */
export function isBarePagePath(path: string): boolean {
  const navigation = navigationFromAppPath(path)

  if (!navigation) return false

  return (
    pageLocationForNavigation(emptyNavigation(navigation.scope, navigation.active)).href ===
    pageLocationForNavigation(navigation).href
  )
}

export function navigationFromAppPath(path: string): NavigationSnapshot | null {
  const parts = splitAppPath(path)

  if (!parts) return null
  const { segs, query } = parts

  if (segs[0] !== 'teams' || !segs[1]) return null
  const teamId = segs[1]
  const rest = segs.slice(2)
  const teamScope: Scope = { kind: 'team', teamId }

  if (rest.length === 0) return emptyNavigation(teamScope, 'team.agent')

  switch (rest[0]) {
    case 'new':
      return emptyNavigation(teamScope, 'team.new-tab')
    case 'agent': {
      if (rest[1] === 'memories') return emptyNavigation(teamScope, 'team.agent-memories')
      if (rest[1] === 'archived') return emptyNavigation(teamScope, 'team.archived-chats')
      if (rest[1] === 'skills') {
        return emptyNavigation(teamScope, 'team.agent-skills', rest[2] ? { filter: rest[2] } : {})
      }
      if (rest[1]) return emptyNavigation(teamScope, 'team.agent', { agentSessionId: rest[1] })

      return emptyNavigation(teamScope, 'team.agent')
    }
    case 'plans':
      return emptyNavigation(teamScope, 'team.plans', rest[1] ? { filter: rest[1] } : {})
    case 'triggers':
      return emptyNavigation(teamScope, 'team.triggers')
    // Legacy: the Chats page merged into Agent, which now carries the
    // conversation list beside the chat. Links out there — shared URLs, older
    // clients — still resolve; nothing produces this path any more.
    case 'chats':
      return emptyNavigation(teamScope, 'team.agent', rest[1] ? { agentSessionId: rest[1] } : {})
    case 'audit':
      return emptyNavigation(teamScope, 'team.audit')
    case 'files':
      return emptyNavigation(teamScope, 'team.files')
    case 'terminal':
      return emptyNavigation(teamScope, 'team.terminal')
    case 'browser':
      return emptyNavigation(teamScope, 'team.browser', {
        browserUrl: query.get('url') || undefined,
      })
    case 'monitoring':
      return emptyNavigation(teamScope, 'team.monitoring')
    // Legacy: the Schedule page is now the Triggers page's Calendar view.
    case 'schedule':
      return emptyNavigation(teamScope, 'team.schedule')
    case 'architecture':
      return emptyNavigation(
        teamScope,
        'team.architecture',
        rest[1] ? { architectureDetail: { diagramId: rest[1], diagramName: 'Diagram' } } : {},
      )
    // Legacy: the Dashboards page was called Cost Management.
    case 'cost-management':
    case 'dashboards':
      return emptyNavigation(
        teamScope,
        'team.dashboards',
        rest[1]
          ? {
              nuphosDashboard: {
                dashboardId: rest[1],
                dashboardName: 'Dashboard',
                ...(parseDashboardViewRange(query)
                  ? { viewRange: parseDashboardViewRange(query) }
                  : {}),
              },
            }
          : {},
      )
    case 'observability': {
      if (rest[1] === 'grafana' && rest[2]) {
        const grafanaInstance = { id: rest[2], name: rest[2], url: '' }
        const inner = rest.slice(3)

        if (inner[0] === 'alerts') {
          return emptyNavigation(teamScope, 'observability.alerts', { grafanaInstance })
        }
        if (inner[0] === 'datasources') {
          if (inner[1] && inner[2] === 'trace-explorer') {
            return emptyNavigation(teamScope, 'observability.datasources', {
              grafanaInstance,
              traceDatasourceTarget: { uid: inner[1], name: inner[1], type: 'tempo' },
            })
          }
          if (inner[1] && inner[2] === 'log-explorer') {
            return emptyNavigation(teamScope, 'observability.datasources', {
              grafanaInstance,
              logDatasourceTarget: { uid: inner[1], name: inner[1], type: 'loki' },
            })
          }

          return emptyNavigation(teamScope, 'observability.datasources', { grafanaInstance })
        }
        if (inner[0] === 'dashboards' && inner[1]) {
          return emptyNavigation(teamScope, 'observability.dashboards', {
            grafanaInstance,
            dashboardTarget: { uid: inner[1], title: inner[1] },
          })
        }

        return emptyNavigation(teamScope, 'observability.dashboards', { grafanaInstance })
      }

      return emptyNavigation(teamScope, 'team.observability')
    }
    case 'repository': {
      const inner = rest.slice(1)

      if (inner[0] === 'gitlab') {
        return emptyNavigation(teamScope, 'team.repository', { repoProvider: 'gitlab' })
      }
      if (inner[0] === 'installations' && inner[1]) {
        const installationId = inner[1]

        if (inner[2] === 'repos' && inner[3] && inner[4]) {
          const tab = inner[5] === 'workflows' ? ('actions' as const) : ('prs' as const)
          const state = query.get('state')
          const prState: GithubPRState | null =
            state === 'closed' || state === 'all' || state === 'open' ? state : null

          if (inner[5] === 'pull-requests' && inner[6] && /^\d+$/.test(inner[6])) {
            // A PR link without a state may point at a merged or closed PR, so
            // the list it backs out to must be able to show it.
            return emptyNavigation(teamScope, 'team.repository', {
              githubNav: {
                view: 'pull',
                installation: githubInstallationFromId(installationId, inner[3]),
                repo: githubRepositoryFromPath(inner[3], inner[4]),
                prNumber: Number(inner[6]),
                prTitle: 'Pull request',
                prState: prState ?? 'all',
              },
            })
          }

          return emptyNavigation(teamScope, 'team.repository', {
            githubNav: {
              view: 'repo',
              installation: githubInstallationFromId(installationId, inner[3]),
              repo: githubRepositoryFromPath(inner[3], inner[4]),
              tab,
              prState: prState ?? 'open',
            },
          })
        }

        return emptyNavigation(teamScope, 'team.repository', {
          githubNav: { view: 'repos', installation: githubInstallationFromId(installationId) },
        })
      }

      return emptyNavigation(teamScope, 'team.repository')
    }
    case 'linear':
      return linearNavigation(teamScope, rest.slice(1))
    case 'settings': {
      if (rest[1] === 'members') return emptyNavigation(teamScope, 'team.members')
      // Legacy: connectors used to live under /settings/integrations.
      if (rest[1] === 'integrations') return connectorsNavigation(teamId, rest.slice(2), query)

      return emptyNavigation(teamScope, 'team.integrations')
    }
    case 'connectors':
      return connectorsNavigation(teamId, rest.slice(1), query)
    case 'compliance': {
      const provider = rest[1]

      if ((provider === 'secureframe' || provider === 'vanta') && rest[2] && rest[3] === 'tests') {
        // A /tests/<name> drill-down parses to the list — the view has no
        // per-test detail state to restore yet.
        return emptyNavigation({
          kind: 'compliance-integration',
          teamId,
          provider,
          integrationId: rest[2],
        })
      }

      return null
    }
    case 'k8s':
      return kubernetesNavigation(teamId, rest.slice(1), query)
    case 'infra':
      return infraNavigation(teamId, rest.slice(1))
  }

  return null
}

/** The team a path belongs to, or null for non-team paths. */
export function teamIdFromAppPath(path: string): string | null {
  const parts = splitAppPath(path)

  if (!parts) return null

  return parts.segs[0] === 'teams' && parts.segs[1] ? parts.segs[1] : null
}
