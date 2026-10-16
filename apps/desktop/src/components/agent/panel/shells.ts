import type { RuntimeExecution } from '../../../lib/runtimeExecution'
import type { SessionDesktop } from '../../../lib/sessionDesktops'

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

/** This session's desktops, by X display and the title the backend gives them, in wire order. */
export function desktopsFromRuntimeState(snapshot: RuntimeExecution | undefined): SessionDesktop[] {
  return (snapshot?.tools ?? []).flatMap((tool) =>
    tool.desktop
      ? [{ display: tool.desktop.display, title: tool.title ?? `:${String(tool.desktop.display)}` }]
      : [],
  )
}
