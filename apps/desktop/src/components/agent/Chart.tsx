import { memo } from 'react'

import { ChartPlot } from '../ChartPlot'

import type { ChartPayload } from './chartPayload'

/** Self-contained chart card used inside Agent messages. */
export const Chart = memo(({ payload }: { payload: ChartPayload }) => {
  const { title, description } = payload

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-zGray-800 bg-zGray-900/40 px-3 pt-3 pb-1.5">
      <div className="mb-1">
        <div className="text-[13.5px] font-medium text-main">{title}</div>
        {description && <div className="text-[12px] text-tertiary">{description}</div>}
      </div>
      <ChartPlot payload={payload} />
    </div>
  )
})

Chart.displayName = 'Chart'
