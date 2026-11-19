import { useQuery } from '@tanstack/react-query'

import { api } from '../../api'
import { getDashboard, listAlertRules, listDashboards, listDatasources } from '../../grafana/client'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'

import { queryKeys } from './keys'

import type { GrafanaTarget } from '../../grafana/client'

// Like the rest of a workspace tab: polled while it is the active tab and the window is visible.
const POLL_MS = 5_000

/** The Grafana instances bound to a team. */
export function useGrafanaInstances(teamId: string) {
  const { isActive } = useWorkspaceTab()

  return useQuery({
    queryKey: queryKeys.grafanaInstances(teamId),
    queryFn: () => api.atlasListGrafanaInstances(teamId),
    refetchInterval: isActive && POLL_MS,
  })
}

export function useGrafanaDashboards(target: GrafanaTarget) {
  const { isActive } = useWorkspaceTab()

  return useQuery({
    queryKey: queryKeys.grafana(target.teamId, target.instanceId, 'dashboards'),
    queryFn: () => listDashboards(target),
    refetchInterval: isActive && POLL_MS,
  })
}

export function useGrafanaAlertRules(target: GrafanaTarget) {
  const { isActive } = useWorkspaceTab()

  return useQuery({
    queryKey: queryKeys.grafana(target.teamId, target.instanceId, 'alert-rules'),
    queryFn: () => listAlertRules(target),
    refetchInterval: isActive && POLL_MS,
  })
}

export function useGrafanaDatasources(target: GrafanaTarget) {
  const { isActive } = useWorkspaceTab()

  return useQuery({
    queryKey: queryKeys.grafana(target.teamId, target.instanceId, 'datasources'),
    queryFn: () => listDatasources(target),
    refetchInterval: isActive && POLL_MS,
  })
}

/** A dashboard's definition, polled so panels someone else (e.g. the agent) adds appear on their
 *  own. An unchanged definition keeps its identity, so polling alone never re-runs panel queries. */
export function useGrafanaDashboardDefinition(target: GrafanaTarget, uid: string) {
  const { isActive } = useWorkspaceTab()

  return useQuery({
    queryKey: queryKeys.grafana(target.teamId, target.instanceId, 'dashboard', uid),
    queryFn: () => getDashboard(target, uid),
    refetchInterval: isActive && POLL_MS,
  })
}
