import { formatValue } from '../format'
import { statFontSize } from '../statFontSize'
import { useElementSize } from '../useElementSize'

import type { DataFrame } from '../types'

type Props = {
  frames: DataFrame[]
  unit?: string
}

export function StatPanel({ frames, unit }: Props) {
  const value = lastNumeric(frames)
  const text = formatValue(value, unit)
  const { ref, width, height } = useElementSize<HTMLDivElement>()

  return (
    <div ref={ref} className="absolute inset-0 flex items-center justify-center px-3">
      <div
        className="text-main font-semibold tracking-tight whitespace-nowrap"
        style={{ fontSize: `${statFontSize(text, width, height).toFixed(1)}px` }}
      >
        {text}
      </div>
    </div>
  )
}

function lastNumeric(frames: DataFrame[]): number | null {
  for (const f of frames) {
    const numField = f.fields.find((x) => x.type === 'number')

    if (!numField) continue
    for (let i = numField.values.length - 1; i >= 0; i--) {
      const v = numField.values[i]

      if (v == null) continue
      const n = Number(v)

      if (Number.isFinite(n)) return n
    }
  }

  return null
}
