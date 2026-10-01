// Client-side tools (local_exec, port forwards, attachment upload) execute in
// the Electron main process while the renderer parks the turn on the IPC call.
// That phase runs with `streamId: null`, so it sits outside every stream
// watchdog: an invoke that never settles left the turn frozen on a spinning
// tool card — no error, no resume, no recovery short of the user hitting Stop.
// This deadline is the backstop for that, not for the tool's own work (the
// main process bounds local_exec itself).

// local_exec is not listed: it no longer executes through this client-tool
// path (the backend dispatches it to a device directly), so it falls through
// to CLIENT_TOOL_DEFAULT_DEADLINE_MS like any other unlisted tool.
export const CLIENT_TOOL_DEADLINE_MS: Record<string, number> = {}

// Uploads and port-forward setup can legitimately outlast a shell command.
export const CLIENT_TOOL_DEFAULT_DEADLINE_MS = 120_000

export function clientToolDeadlineMs(toolName: string): number {
  return CLIENT_TOOL_DEADLINE_MS[toolName] ?? CLIENT_TOOL_DEFAULT_DEADLINE_MS
}

export function clientToolDeadlineMessage(toolName: string, deadlineMs: number): string {
  return `${toolName} did not respond after ${String(Math.round(deadlineMs / 1000))}s on this machine.`
}

/**
 * Reject if `invoke` has not settled within the tool's deadline, so the caller
 * can attach a real error to the tool call and let the turn continue.
 */
export async function withClientToolDeadline<T>(
  toolName: string,
  invoke: () => Promise<T>,
  opts: {
    deadlineMs?: number
    onDeadline?: (info: { toolName: string; deadlineMs: number }) => void
  } = {},
): Promise<T> {
  const deadlineMs = opts.deadlineMs ?? clientToolDeadlineMs(toolName)
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      invoke(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          opts.onDeadline?.({ toolName, deadlineMs })
          reject(new Error(clientToolDeadlineMessage(toolName, deadlineMs)))
        }, deadlineMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
