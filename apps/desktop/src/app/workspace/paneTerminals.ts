import { selectAllResidentTabs } from './store/workspaceState.ts'

import type { WorkspaceState } from './store/workspaceState'

/** Terminals a pane would stop if it closed: local shells and SSH sessions in any of its chats. */
export function paneTerminalCount(state: WorkspaceState): number {
  return selectAllResidentTabs(state).filter(
    (tab) => tab.active === 'team.terminal' || tab.sshTerminal !== null,
  ).length
}
