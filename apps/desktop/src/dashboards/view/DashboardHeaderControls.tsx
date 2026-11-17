import { RefreshButton } from '../../components/toolbar-controls'
import { t } from '../../i18n'

import { CadenceMenu } from './CadenceMenu'
import { refreshAge } from './helpers'
import { VisibilityMenu } from './VisibilityMenu'

import type { NuphosDashboard, NuphosDashboardDetail } from '../schema'

/** The open dashboard's header controls: last refresh, who sees it, auto-refresh, refresh. */
export function DashboardHeaderControls({
  teamId,
  detail,
  lastRefreshAt,
  refreshing,
  onRefresh,
  onSaved,
}: {
  teamId: string
  detail: NuphosDashboardDetail | null
  lastRefreshAt: string | null
  refreshing: boolean
  onRefresh: () => void
  onSaved: (dashboard: NuphosDashboard) => void
}) {
  return (
    <>
      <span
        title={lastRefreshAt ? new Date(lastRefreshAt).toLocaleString() : undefined}
        className="hidden whitespace-nowrap text-[12px] text-tertiary @xl:inline"
      >
        {lastRefreshAt ? refreshAge(lastRefreshAt) : t('No completed refresh')}
      </span>
      <VisibilityMenu teamId={teamId} detail={detail} onSaved={onSaved} />
      <CadenceMenu teamId={teamId} detail={detail} onSaved={onSaved} />
      <RefreshButton onRefresh={onRefresh} loading={refreshing} />
    </>
  )
}
