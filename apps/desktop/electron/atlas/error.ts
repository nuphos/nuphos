// IPC strips custom Error properties when crossing the main/renderer boundary,
// so encode {code, details} into the message under a sentinel prefix that the
// renderer recovers with parseAtlasError(). Kept in a leaf module of its own:
// the agent HTTP client needs it too, and that tree is loaded by plain-node
// tests that cannot resolve atlas/client.ts's own imports.
export const ATLAS_ERROR_SENTINEL = '__ATLAS_API_ERROR__'

export function buildAtlasError(message: string, code?: string, details?: unknown): Error {
  if (code === undefined && details === undefined) return new Error(message)

  return new Error(`${ATLAS_ERROR_SENTINEL}${JSON.stringify({ message, code, details })}`)
}

/** The message and code of a backend error buildAtlasError made, for main-side callers. */
export function atlasErrorInfo(e: unknown): { message: string; code?: string } {
  const raw = e instanceof Error ? e.message : String(e)
  const at = raw.indexOf(ATLAS_ERROR_SENTINEL)

  if (at === -1) return { message: raw }
  try {
    const parsed = JSON.parse(raw.slice(at + ATLAS_ERROR_SENTINEL.length)) as {
      message?: string
      code?: string
    }

    return { message: parsed.message ?? raw, code: parsed.code }
  } catch {
    return { message: raw }
  }
}
