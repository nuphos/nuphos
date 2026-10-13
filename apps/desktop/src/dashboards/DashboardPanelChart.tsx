import { memo } from 'react'

import { ChartPlot } from '../components/ChartPlot'

import type { ChartPayload } from '../components/agent/chartPayload'

/** Chart content for a dashboard panel; PanelCard owns its title/chrome. */
export const DashboardPanelChart = memo(
  ({ payload, fill = false }: { payload: ChartPayload; fill?: boolean }) => (
    <div className={fill ? 'h-full py-1' : 'py-1'}>
      <ChartPlot payload={payload} fill={fill} />
    </div>
  ),
)

DashboardPanelChart.displayName = 'DashboardPanelChart'
