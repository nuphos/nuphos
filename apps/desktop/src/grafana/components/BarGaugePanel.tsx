import { barGaugeVertical, buildBarGauge } from '../barGauge'

import type { BarGaugeBar } from '../barGauge'
import type { DataFrame, Panel } from '../types'

type Props = {
  frames: DataFrame[]
  panel: Panel
  unit?: string
}

export function BarGaugePanel({ frames, panel, unit }: Props) {
  const bars = buildBarGauge(frames, panel, unit)

  if (bars.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-tertiary text-[12px]">
        No data
      </div>
    )
  }

  return (
    <div className="absolute inset-0 overflow-auto scrollbar-thin px-3 py-2">
      {barGaugeVertical(panel) ? <VerticalBars bars={bars} /> : <HorizontalBars bars={bars} />}
    </div>
  )
}

function HorizontalBars({ bars }: { bars: BarGaugeBar[] }) {
  return (
    <div className="flex h-full flex-col justify-around gap-1.5">
      {bars.map((bar) => (
        <div key={bar.label} className="flex min-w-0 items-center gap-2">
          <span
            className="w-[30%] max-w-[160px] flex-shrink-0 truncate text-[11px] text-tertiary"
            title={bar.label}
          >
            {bar.label}
          </span>
          <span className="relative h-4 min-w-0 flex-1 overflow-hidden rounded-sm bg-zGray-800/60">
            <span
              className="absolute inset-y-0 left-0 rounded-sm"
              style={{ width: `${String(bar.fraction * 100)}%`, background: bar.color }}
            />
          </span>
          <span
            className="flex-shrink-0 text-right text-[11.5px] font-medium"
            style={{ color: bar.color }}
          >
            {bar.text}
          </span>
        </div>
      ))}
    </div>
  )
}

function VerticalBars({ bars }: { bars: BarGaugeBar[] }) {
  return (
    <div className="flex h-full items-stretch justify-around gap-2">
      {bars.map((bar) => (
        <div key={bar.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <span className="text-[11.5px] font-medium" style={{ color: bar.color }}>
            {bar.text}
          </span>
          <span className="relative w-full min-w-0 flex-1 overflow-hidden rounded-sm bg-zGray-800/60">
            <span
              className="absolute inset-x-0 bottom-0 rounded-sm"
              style={{ height: `${String(bar.fraction * 100)}%`, background: bar.color }}
            />
          </span>
          <span className="w-full truncate text-center text-[11px] text-tertiary" title={bar.label}>
            {bar.label}
          </span>
        </div>
      ))}
    </div>
  )
}
