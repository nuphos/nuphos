import { LINEAR_PAGE_KEY } from '../linearNav.ts'

import { linearPagePath } from './linearParse.ts'
import { pageLocation, pathSegment } from './sections.ts'

import type { NavigationSnapshot, PageLocation } from './types.ts'
import type { Scope } from '../../types'

export function teamPageLocation(
  navigation: NavigationSnapshot,
  scope: Extract<Scope, { kind: 'team' }>,
): PageLocation {
  const {
    active,
    grafanaInstance,
    dashboardTarget,
    traceDatasourceTarget,
    logDatasourceTarget,
    githubNav,
    repoProvider,
  } = navigation

  if (active === 'team.new-tab') {
    return pageLocation(`/teams/${pathSegment(scope.teamId)}/new`)
  }
  if (active === 'team.agent') {
    const base = `/teams/${pathSegment(scope.teamId)}/agent`

    return pageLocation(
      navigation.agentSessionId ? `${base}/${pathSegment(navigation.agentSessionId)}` : base,
    )
  }
  if (active === 'team.observability') {
    return pageLocation(`/teams/${pathSegment(scope.teamId)}/observability`)
  }
  if (
    active === 'observability.dashboards' ||
    active === 'observability.datasources' ||
    active === 'observability.alerts'
  ) {
    if (!grafanaInstance) {
      return pageLocation(`/teams/${pathSegment(scope.teamId)}/observability`)
    }
    const base = `/teams/${pathSegment(scope.teamId)}/observability/grafana/${pathSegment(grafanaInstance.id)}`

    if (active === 'observability.datasources') {
      if (traceDatasourceTarget) {
        return pageLocation(
          `${base}/datasources/${pathSegment(traceDatasourceTarget.uid)}/trace-explorer`,
        )
      }
      if (logDatasourceTarget) {
        return pageLocation(
          `${base}/datasources/${pathSegment(logDatasourceTarget.uid)}/log-explorer`,
        )
      }

      return pageLocation(`${base}/datasources`)
    }
    if (active === 'observability.alerts') {
      return pageLocation(`${base}/alerts`)
    }
    if (dashboardTarget) {
      return pageLocation(`${base}/dashboards/${pathSegment(dashboardTarget.uid)}`)
    }

    return pageLocation(`${base}/dashboards`)
  }
  if (active === 'team.repository') {
    const base = `/teams/${pathSegment(scope.teamId)}/repository`

    if (repoProvider === 'gitlab') {
      return pageLocation(`${base}/gitlab`)
    }
    if (githubNav.view === 'repos') {
      return pageLocation(
        `${base}/installations/${pathSegment(String(githubNav.installation.installationId))}`,
      )
    }
    if (githubNav.view === 'repo') {
      const [owner = '', repo = githubNav.repo.name] = githubNav.repo.fullName.split('/')
      const tabSegment = githubNav.tab === 'prs' ? 'pull-requests' : 'workflows'

      return pageLocation(
        `${base}/installations/${pathSegment(String(githubNav.installation.installationId))}/repos/${pathSegment(owner)}/${pathSegment(repo)}/${tabSegment}`,
        githubNav.tab === 'prs' ? { state: githubNav.prState } : undefined,
      )
    }
    if (githubNav.view === 'pull') {
      const [owner = '', repo = githubNav.repo.name] = githubNav.repo.fullName.split('/')

      return pageLocation(
        `${base}/installations/${pathSegment(String(githubNav.installation.installationId))}/repos/${pathSegment(owner)}/${pathSegment(repo)}/pull-requests/${pathSegment(String(githubNav.prNumber))}`,
        { state: githubNav.prState },
      )
    }

    return pageLocation(base)
  }
  if (active === LINEAR_PAGE_KEY) {
    return pageLocation(linearPagePath(scope.teamId, navigation.linearNav))
  }
  if (active === 'team.agent-memories') {
    return pageLocation(`/teams/${pathSegment(scope.teamId)}/agent/memories`)
  }
  if (active === 'team.archived-chats') {
    return pageLocation(`/teams/${pathSegment(scope.teamId)}/agent/archived`)
  }
  if (active === 'team.agent-skills') {
    const base = `/teams/${pathSegment(scope.teamId)}/agent/skills`
    const skillName = navigation.filter?.trim()

    return pageLocation(skillName ? `${base}/${pathSegment(skillName)}` : base)
  }
  if (active === 'team.architecture') {
    const base = `/teams/${pathSegment(scope.teamId)}/architecture`

    return pageLocation(
      navigation.architectureDetail
        ? `${base}/${pathSegment(navigation.architectureDetail.diagramId)}`
        : base,
    )
  }
  if (active === 'team.dashboards') {
    const base = `/teams/${pathSegment(scope.teamId)}/dashboards`

    return pageLocation(
      navigation.nuphosDashboard
        ? `${base}/${pathSegment(navigation.nuphosDashboard.dashboardId)}`
        : base,
      navigation.nuphosDashboard?.viewRange,
    )
  }
  if (active === 'team.plans') {
    const base = `/teams/${pathSegment(scope.teamId)}/plans`
    // An exact plan number in the filter is how /plans/<n> deep links
    // arrive; serialize it back so copy-URL and restored tabs round-trip.
    const planNumber = /^#?(\d+)$/.exec(navigation.filter?.trim() ?? '')

    return pageLocation(planNumber ? `${base}/${planNumber[1]}` : base)
  }
  // A top-level path, not /agent/triggers: every page added under /agent/
  // must also be taught to AGENT_SUBPAGE_SEGMENTS below, and missing that
  // step reads the segment as a session id (it shipped that way for Skills
  // once). Plans is top-level for the same reason.
  if (active === 'team.triggers') {
    return pageLocation(`/teams/${pathSegment(scope.teamId)}/triggers`)
  }
  if (active === 'team.audit') {
    return pageLocation(`/teams/${pathSegment(scope.teamId)}/audit`)
  }
  if (active === 'team.terminal') {
    return pageLocation(`/teams/${pathSegment(scope.teamId)}/terminal`)
  }
  if (active === 'team.browser') {
    const query = navigation.browserUrl
      ? `?${new URLSearchParams({ url: navigation.browserUrl })}`
      : ''

    return pageLocation(`/teams/${pathSegment(scope.teamId)}/browser${query}`)
  }
  if (active === 'team.monitoring') {
    return pageLocation(`/teams/${pathSegment(scope.teamId)}/monitoring`)
  }
  if (active === 'team.schedule') {
    return pageLocation(`/teams/${pathSegment(scope.teamId)}/schedule`)
  }
  if (active === 'team.members') {
    return pageLocation(`/teams/${pathSegment(scope.teamId)}/settings/members`)
  }
  if (navigation.connectorDetail) {
    return pageLocation(
      `/teams/${pathSegment(scope.teamId)}/connectors/${pathSegment(navigation.connectorDetail.provider)}/${pathSegment(navigation.connectorDetail.connectorId)}`,
    )
  }

  return pageLocation(`/teams/${pathSegment(scope.teamId)}/connectors`, {
    'add-modal-opened': navigation.addIntegrationOpen ? '1' : null,
  })
}
