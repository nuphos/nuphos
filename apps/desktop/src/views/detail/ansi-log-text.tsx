import Anser from 'anser'
import { memo } from 'react'

import { safeAnsiLogMessage } from '../../lib/logView'

import type { CSSProperties } from 'react'

const DECORATION_STYLE: Partial<Record<string, CSSProperties>> = {
  bold: { fontWeight: 'bold' },
  dim: { opacity: 0.5 },
  italic: { fontStyle: 'italic' },
  underline: { textDecoration: 'underline' },
  strikethrough: { textDecoration: 'line-through' },
}

// A log line is not an interactive terminal, but it can carry terminal SGR
// styling, rendered as inline spans. The sanitizer keeps styling
// presentation-only, and React still escapes the log content itself.
export const AnsiLogText = memo(function AnsiLogText({ message }: { message: string }) {
  const parts = Anser.ansiToJson(safeAnsiLogMessage(message), { remove_empty: true })

  return (
    <code className="text-secondary">
      {parts.map((part, i) => (
        <span
          key={i}
          style={{
            color: part.fg ? `rgb(${part.fg})` : undefined,
            backgroundColor: part.bg ? `rgb(${part.bg})` : undefined,
            ...DECORATION_STYLE[part.decoration ?? ''],
          }}
        >
          {part.content}
        </span>
      ))}
    </code>
  )
})
