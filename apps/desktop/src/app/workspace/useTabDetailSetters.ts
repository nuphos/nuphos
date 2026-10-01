import { useCallback } from 'react'

import { withLinearNav } from '../../lib/linearNav'

import type { UpdateWorkspaceTab } from './paneTypes'
import type {
  AwsResourceDetailRef,
  AwsS3Detail,
  CloudflareResourceDetailRef,
  ConnectorDetailRef,
  LinearNavState,
  NuphosDashboardRef,
  TriggerFormRef,
} from '../../lib/appRoutes'
import type { DetailTarget } from '../../views/DetailView'

export function useTabDetailSetters(tabId: string, updateTab: UpdateWorkspaceTab) {
  const setTarget = useCallback(
    (target: DetailTarget | null) => {
      updateTab(tabId, (cur) => (cur.target === target ? cur : { ...cur, target }))
    },
    [tabId, updateTab],
  )
  const setS3Detail = useCallback(
    (s3Detail: AwsS3Detail | null) => {
      updateTab(tabId, (cur) => {
        const a = cur.s3Detail
        const b = s3Detail
        const same =
          (a === null && b === null) ||
          (a !== null &&
            b !== null &&
            a.bucket === b.bucket &&
            a.region === b.region &&
            a.prefix === b.prefix)

        return same ? cur : { ...cur, s3Detail }
      })
    },
    [tabId, updateTab],
  )
  const setAwsDetail = useCallback(
    (awsDetail: AwsResourceDetailRef | null) => {
      updateTab(tabId, (cur) => {
        const a = cur.awsDetail ?? null
        const b = awsDetail
        const same =
          (a === null && b === null) ||
          (a !== null &&
            b !== null &&
            a.kind === b.kind &&
            a.name === b.name &&
            a.region === b.region)

        return same ? cur : { ...cur, awsDetail }
      })
    },
    [tabId, updateTab],
  )
  const setArchitectureDetail = useCallback(
    (architectureDetail: { diagramId: string; diagramName: string } | null) => {
      updateTab(tabId, (cur) => ({ ...cur, architectureDetail }))
    },
    [tabId, updateTab],
  )
  const setTriggerDetail = useCallback(
    (triggerDetail: { triggerId: string; triggerName: string } | null) => {
      updateTab(tabId, (cur) => ({ ...cur, triggerDetail }))
    },
    [tabId, updateTab],
  )
  const setTriggerForm = useCallback(
    (triggerForm: TriggerFormRef | null) => {
      updateTab(tabId, (cur) => ({ ...cur, triggerForm }))
    },
    [tabId, updateTab],
  )
  const setNuphosDashboard = useCallback(
    (nuphosDashboard: NuphosDashboardRef | null) => {
      updateTab(tabId, (cur) => {
        const a = cur.nuphosDashboard ?? null
        const b = nuphosDashboard
        // Same-check: the view re-reports on every dashboard-list reload, and a
        // no-op tab update per poll would churn every consumer of tab state.
        const same =
          (a === null && b === null) ||
          (a !== null &&
            b !== null &&
            a.dashboardId === b.dashboardId &&
            a.dashboardName === b.dashboardName &&
            JSON.stringify(a.viewRange) === JSON.stringify(b.viewRange))

        return same ? cur : { ...cur, nuphosDashboard }
      })
    },
    [tabId, updateTab],
  )
  const setNuphosDashboards = useCallback(
    (nuphosDashboards: { id: string; name: string }[]) => {
      updateTab(tabId, (cur) => {
        const a = cur.nuphosDashboards
        const same =
          a?.length === nuphosDashboards.length &&
          a.every((d, i) => d.id === nuphosDashboards[i].id && d.name === nuphosDashboards[i].name)

        return same ? cur : { ...cur, nuphosDashboards }
      })
    },
    [tabId, updateTab],
  )
  const setLinearNav = useCallback(
    (linearNav: LinearNavState) => {
      updateTab(tabId, (cur) => withLinearNav(cur, linearNav))
    },
    [tabId, updateTab],
  )
  const setConnectorDetail = useCallback(
    (connectorDetail: ConnectorDetailRef | null) => {
      updateTab(tabId, (cur) => ({ ...cur, connectorDetail }))
    },
    [tabId, updateTab],
  )
  const setCloudflareDetail = useCallback(
    (cloudflareDetail: CloudflareResourceDetailRef | null) => {
      updateTab(tabId, (cur) => {
        const a = cur.cloudflareDetail ?? null
        const b = cloudflareDetail
        const same =
          (a === null && b === null) ||
          (a !== null &&
            b !== null &&
            a.kind === b.kind &&
            a.name === b.name &&
            (a.id ?? null) === (b.id ?? null) &&
            (a.prefix ?? null) === (b.prefix ?? null))

        return same ? cur : { ...cur, cloudflareDetail }
      })
    },
    [tabId, updateTab],
  )
  const setAddIntegrationOpen = useCallback(
    (addIntegrationOpen: boolean) => {
      updateTab(tabId, (cur) => ({ ...cur, addIntegrationOpen }))
    },
    [tabId, updateTab],
  )

  return {
    setTarget,
    setS3Detail,
    setAwsDetail,
    setArchitectureDetail,
    setTriggerDetail,
    setTriggerForm,
    setNuphosDashboard,
    setNuphosDashboards,
    setLinearNav,
    setConnectorDetail,
    setCloudflareDetail,
    setAddIntegrationOpen,
  }
}
