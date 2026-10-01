import { TimeSeriesPanel } from '../../grafana/components/TimeSeriesPanel'

import { LOG_RANGE_OPTIONS } from './metrics-explorer-shared'

import type { DataFrame } from '../../grafana/types'
import type { ReactNode } from 'react'

export function RangeButtons({
  rangeMinutes,
  setRangeMinutes,
}: {
  rangeMinutes: number
  setRangeMinutes: (minutes: number) => void
}) {
  return (
    <div className="flex items-center gap-1">
      {LOG_RANGE_OPTIONS.map((opt) => (
        <button
          key={opt.minutes}
          type="button"
          onPointerDown={(event) => {
            if (event.button !== 0) return
            setRangeMinutes(opt.minutes)
          }}
          onClick={(event) => {
            if (event.detail !== 0) return
            setRangeMinutes(opt.minutes)
          }}
          className={`h-6 px-2 rounded text-[11.5px] font-medium ${
            rangeMinutes === opt.minutes
              ? 'bg-zViolet-accent/15 text-zViolet-accent'
              : 'text-tertiary hover:text-main hover:bg-zGray-850'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export function MetricSeriesCard({
  title,
  subtitle,
  frames,
  unit,
  hasData,
}: {
  title: ReactNode
  subtitle: ReactNode
  frames: DataFrame[]
  unit?: string
  hasData: boolean
}) {
  return (
    <div className="flex-1 min-h-0 overflow-auto scrollbar-thin p-4">
      <div className="bg-zGray-950 border border-zGray-850 rounded-md p-3">
        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-[13px] font-medium text-main">{title}</span>
          <span className="text-[11.5px] text-tertiary">{subtitle}</span>
        </div>
        {!hasData ? (
          <div className="text-tertiary text-[12px] py-8">
            No datapoints in this range for the selected metric.
          </div>
        ) : (
          <div className="h-80 relative">
            <TimeSeriesPanel
              frames={frames}
              unit={unit}
              targets={frames.map((f) => ({ refId: f.refId, legendFormat: f.name }))}
            />
          </div>
        )}
      </div>
    </div>
  )
}
