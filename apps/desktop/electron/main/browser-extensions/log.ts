// Extension errors in one file a user can attach to a report: a packaged app's stdout goes nowhere.
import { appendFile, mkdir, stat, truncate } from 'node:fs/promises'
import path from 'node:path'

import { app } from 'electron'

const MAX_BYTES = 1024 * 1024

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

export function logError(...parts: unknown[]) {
  console.error('[browser-extensions]', ...parts)
  const text = parts
    .map((part) => (part instanceof Error ? (part.stack ?? part.message) : String(part)))
    .join(' ')

  logFile()
    .then((file) => appendFile(file, `${new Date().toISOString()} ${text}\n`))
    .catch(() => {
      // Logging must never be why an extension fails.
    })
}
