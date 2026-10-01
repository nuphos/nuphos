import AnsiImport from 'ansi-to-react'
import { memo } from 'react'

import { safeAnsiLogMessage } from '../../lib/logView'

import { resolveAnsiComponent } from './ansi-component'

// ansi-to-react is CommonJS but publishes its component as exports.default.
// Vite's production CJS interop can therefore hand a default import the module
// object ({ default: Ansi }) while dev/typechecking see the function directly.
// Normalize both shapes before React receives the element type.
const Ansi = resolveAnsiComponent(AnsiImport)

// A log line is not an interactive terminal, but it can carry terminal SGR
// styling. ansi-to-react safely converts those sequences into React spans with
// inline foreground/background/decoration styles. The sanitizer keeps styling
// presentation-only, and React still escapes the log content itself.
export const AnsiLogText = memo(function AnsiLogText({ message }: { message: string }) {
  return <Ansi className="text-secondary">{safeAnsiLogMessage(message)}</Ansi>
})
