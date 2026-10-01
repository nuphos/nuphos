import { useMemo } from 'react'
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

import { colorFor, formatValue } from '../grafana/format'

import type { DataFrame } from '../grafana/types'

type Props = {
  frames: DataFrame[]
  unit?: string
  donut?: boolean
  showLabels?: boolean
}

type Slice = { name: string; value: number }

export function GcpPiePanel({ frames, unit, donut, showLabels }: Props) {
  const slices = useMemo(() => buildSlices(frames), [frames])

  if (slices.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-tertiary text-[12px]">
        No data
      </div>
    )
  }

  return (
    <div className="absolute inset-0 p-2">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="46%"
            outerRadius="72%"
            innerRadius={donut ? '42%' : 0}
            paddingAngle={slices.length > 1 ? 1 : 0}
            label={showLabels ? ({ name }) => truncate(String(name ?? ''), 18) : false}
            labelLine={showLabels}
            isAnimationActive={false}
          >
            {slices.map((slice, index) => (
              <Cell key={`${slice.name}:${String(index)}`} fill={colorFor(index)} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => formatValue(Number(value), unit)}
            contentStyle={{
              border: '1px solid rgb(var(--color-zGray-800))',
              borderRadius: 6,
              background: 'rgb(var(--color-zGray-925))',
              color: 'rgb(var(--color-text-main))',
              fontSize: 11,
            }}
          />
          <Legend
            iconSize={8}
            wrapperStyle={{ color: 'rgb(var(--color-text-tertiary))', fontSize: 10 }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

function buildSlices(frames: DataFrame[]): Slice[] {
  const slices: Slice[] = []

  for (const frame of frames) {
    const numberField = frame.fields.find((field) => field.type === 'number')

    if (!numberField) continue
    let value: number | null = null

    for (let index = numberField.values.length - 1; index >= 0; index -= 1) {
      const raw = numberField.values[index]

      if (raw == null) continue
      const candidate = Number(raw)

      if (Number.isFinite(candidate)) {
        value = candidate
        break
      }
    }
    if (value == null || value < 0) continue
    slices.push({ name: frame.name || numberField.name || 'Series', value })
  }

  return slices.sort((a, b) => b.value - a.value)
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}
