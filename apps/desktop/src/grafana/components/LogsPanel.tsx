import { useMemo } from 'react'

import type { DataFrame } from '../types'

type LogRow = {
  ts: number | null
  msg: string
  level?: string
}

type Props = {
  frames: DataFrame[]
}

export function LogsPanel({ frames }: Props) {
  const rows = useMemo(() => buildRows(frames), [frames])

  if (rows.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-tertiary text-[12px]">
        No log entries
      </div>
    )
  }

  return (
    <div className="absolute inset-0 overflow-auto scrollbar-thin">
      <div className="font-mono text-[11.5px] selectable">
        {rows.map((r, i) => (
          <div
            key={i}
            className="flex items-start gap-2 px-3 py-1 border-b border-zGray-850/60 hover:bg-zGray-850/40"
          >
            <span className="text-tertiary tabular-nums flex-shrink-0">
              {r.ts !== null ? new Date(r.ts).toLocaleTimeString() : ''}
            </span>
            {r.level && (
              <span className={`flex-shrink-0 uppercase tracking-wider ${levelColor(r.level)}`}>
                {r.level.slice(0, 4)}
              </span>
            )}
            <span className="text-secondary break-all whitespace-pre-wrap">{r.msg}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function levelColor(level: string): string {
  const l = level.toLowerCase()

  if (l.startsWith('err') || l === 'fatal') return 'text-error'
  if (l.startsWith('warn')) return 'text-zOrangered-400'
  if (l.startsWith('info')) return 'text-zViolet-300'

  return 'text-tertiary'
}

// Frame cells are `unknown`; structured values (Loki JSON lines) are rendered
// as JSON rather than a useless "[object Object]".
function cellText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  return JSON.stringify(value) ?? ''
}

function buildRows(frames: DataFrame[]): LogRow[] {
  const rows: LogRow[] = []

  for (const f of frames) {
    const timeField = f.fields.find((x) => x.type === 'time' && /time|_time/i.test(x.name))
    const msgField =
      f.fields.find((x) => /^_msg$|^message$|^line$|^body$/i.test(x.name)) ||
      f.fields.find((x) => x.type === 'string')

    if (!msgField) continue
    const levelField = f.fields.find((x) => /level|severity/i.test(x.name))
    const len = msgField.values.length

    for (let i = 0; i < len; i++) {
      const tsRaw = timeField ? Number(timeField.values[i]) : NaN
      const msg = cellText(msgField.values[i])
      const level = levelField ? cellText(levelField.values[i]) : undefined

      rows.push({ ts: Number.isFinite(tsRaw) ? tsRaw : null, msg, level })
    }
  }
  // Newest first.
  rows.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))

  return rows.slice(0, 500)
}
