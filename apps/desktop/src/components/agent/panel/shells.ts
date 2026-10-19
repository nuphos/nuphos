import type { RuntimeExecution } from '../../../lib/runtimeExecution'
import type { SessionDesktop, SessionDesktops } from '../../../lib/sessionDesktops'

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

/** This session's desktops, by display, machine and the title the backend gives them, in wire order. */
export function desktopsFromRuntimeState(snapshot: RuntimeExecution | undefined): SessionDesktop[] {
  return (snapshot?.tools ?? []).flatMap((tool) =>
    tool.desktop
      ? [
          {
            display: tool.desktop.display,
            title: tool.title ?? `:${String(tool.desktop.display)}`,
            deviceId: tool.desktop.deviceId,
          },
        ]
      : [],
  )
}

/**
 * What the dock gets for a conversation: its desktops, and "Desktop" only for its owner, the one
 * the Box admits, where it can claim one or already holds one: New Tab is the way to its tab.
 */
export function sessionDesktopsOf(
  teamId: string,
  tab: { runtimeState?: RuntimeExecution; foreign?: boolean },
): SessionDesktops {
  const desktops = desktopsFromRuntimeState(tab.runtimeState)

  return {
    teamId,
    desktops,
    canOpen: (tab.runtimeState?.canOpenDesktop === true || desktops.length > 0) && !tab.foreign,
  }
}
