import type { RuntimeExecution } from '../../../lib/runtimeExecution'

export type ShellEntry = {
  id: string
  terminalId: string
  command: string
  output: string
  status: 'running' | 'exited'
  exitCode?: number | null
  signal?: string | null
}

/** Terminal-bearing tool entries from the latest runtime snapshot, in wire order. */
export function shellsFromRuntimeState(snapshot: RuntimeExecution | undefined): ShellEntry[] {
  if (!snapshot?.tools?.length) return []

  const shells: ShellEntry[] = []

  for (const tool of snapshot.tools) {
    if (!tool.terminal) continue
    shells.push({
      id: tool.id,
      terminalId: tool.terminal.terminalId,
      command: tool.terminal.command ?? '',
      output: tool.terminal.output ?? '',
      status: tool.terminal.status,
      exitCode: tool.terminal.exit?.exitCode,
      signal: tool.terminal.exit?.signal,
    })
  }

  return shells
}
