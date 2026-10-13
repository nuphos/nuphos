import { createWorkspaceTab } from '../workspaceTabFactory.ts'

import type { WorkspaceStore } from './store/workspaceStore.ts'
import type { DockTerminalRequest } from '../../api/local-terminal-types.ts'

/** The backend has already authorized the device, team and owning conversation. */
export async function openDockTerminal(
  store: WorkspaceStore,
  request: DockTerminalRequest,
  accept: (id: string) => Promise<boolean>,
): Promise<void> {
  if (!store.getState().teamsKnown || !(await accept(request.id))) return
  store.dispatch({
    type: 'openTab',
    sessionKey: request.sessionId,
    tab: { ...createWorkspaceTab(request.teamId), id: request.id, active: 'team.terminal' },
    options: { openDock: true },
  })
}
