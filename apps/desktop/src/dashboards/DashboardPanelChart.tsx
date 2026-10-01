import { memo } from 'react'

import { ChartPlot } from '../components/ChartPlot'

import type { ChartPayload } from '../components/agent/chartPayload'

/** Chart content for a dashboard panel; PanelCard owns its title/chrome. */
export const DashboardPanelChart = memo(({ payload }: { payload: ChartPayload }) => (
  <div className="py-1">
    <ChartPlot payload={payload} />
  </div>
))

DashboardPanelChart.displayName = 'DashboardPanelChart'
