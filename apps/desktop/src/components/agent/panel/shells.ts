import type { RuntimeExecution } from '../../../lib/runtimeExecution'

export type ShellEntry = {
  id: string
  terminalId: string
  command: string
  output: string
}

/** Running terminals from the latest runtime snapshot, in wire order. */
export function shellsFromRuntimeState(snapshot: RuntimeExecution | undefined): ShellEntry[] {
  return (snapshot?.tools ?? []).flatMap((tool) =>
    tool.terminal?.status === 'running'
      ? [
          {
            id: tool.id,
            terminalId: tool.terminal.terminalId,
            command: tool.terminal.command ?? '',
            output: tool.terminal.output ?? '',
          },
        ]
      : [],
  )
}
