// Extension failures in one file a user can attach to a report: a packaged app's stdout goes
// nowhere. Lines are our own short diagnostics, never what an extension printed: a password
// manager's console can hold account or vault data.
import { appendFile, mkdir, stat, truncate } from 'node:fs/promises'
import path from 'node:path'

import { app } from 'electron'

const MAX_BYTES = 1024 * 1024
const MAX_LINE = 300

let ready: Promise<string> | null = null

/** The log, emptied once per launch when it has grown past MAX_BYTES. */
function logFile() {
  ready ??= (async () => {
    const file = path.join(app.getPath('logs'), 'browser-extensions.log')

    await mkdir(path.dirname(file), { recursive: true })
    const size = (await stat(file).catch(() => null))?.size ?? 0

    if (size > MAX_BYTES) await truncate(file)

    return file
  })()

  return ready
}

/** One line, at most MAX_LINE characters. */
export function diagnosticLine(parts: unknown[]) {
  return parts
    .map((part) => (part instanceof Error ? `${part.name}: ${part.message}` : String(part)))
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, MAX_LINE)
}

/**
 * A service worker's uncaught exception as its error type and where it was thrown, without
 * the message, which can carry whatever the extension was handling. Null for anything else.
 */
export function uncaughtException(message: string, sourceUrl: string, lineNumber: number) {
  const type = /^Uncaught (\w+)/.exec(message)?.[1]
  const source = /^chrome-extension:\/\/[a-p]{32}\/[^?#\s]*/.exec(sourceUrl)?.[0]

  return type ? `${source ?? 'service worker'}:${String(lineNumber)} uncaught ${type}` : null
}

export function logError(...parts: unknown[]) {
  const line = diagnosticLine(parts)

  console.error('[browser-extensions]', line)
  logFile()
    .then((file) => appendFile(file, `${new Date().toISOString()} ${line}\n`))
    .catch(() => {
      // Logging must never be why an extension fails.
    })
}
