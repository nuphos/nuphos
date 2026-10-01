import { ArrowLeft, ExternalLink } from 'lucide-react'

import { api } from '../../api'
import { PageHeader } from '../../components/PageHeader'

import type { GcpMonitoringDashboardSummary } from '../../types'

export function DashboardDetailHeader({
  summary,
  onBack,
}: {
  summary: GcpMonitoringDashboardSummary
  onBack: () => void
}) {
  return (
    <PageHeader
      title={summary.displayName}
      subtitle="Cloud Monitoring custom dashboard · read-only"
      actions={
        <>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-8 items-center gap-1.5 rounded border border-zGray-800 px-2.5 text-[11.5px] text-secondary hover:bg-zGray-850 hover:text-main"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
            Dashboards
          </button>
          <button
            type="button"
            onClick={() => void api.appOpenExternal(summary.consoleUrl)}
            className="inline-flex h-8 items-center gap-1.5 rounded border border-zGray-800 px-2.5 text-[11.5px] text-secondary hover:bg-zGray-850 hover:text-main"
          >
            Open in GCP
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        </>
      }
    />
  )
}
