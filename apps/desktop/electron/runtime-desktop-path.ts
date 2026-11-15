/**
 * A runtime-desktop target in the API path: a conversation's id as one segment, or
 * `runtime/<id>` for a computer's own screen. Only that prefix stays a separate segment,
 * so no id from a tab's route can reach another API path.
 */
export function desktopPath(sessionId: string): string {
  const runtime = /^runtime\/(.+)$/u.exec(sessionId)?.[1]

  return runtime ? `runtime/${encodeURIComponent(runtime)}` : encodeURIComponent(sessionId)
}
