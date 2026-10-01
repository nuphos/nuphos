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
