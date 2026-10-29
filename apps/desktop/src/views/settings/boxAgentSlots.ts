import type { MachineState } from './boxPresentation'
import type { RuntimeInstance } from '../../types/runtime'

/**
 * What a machine shows in its agent row. Only a machine that is setting up or restarting is
 * "starting"; an empty list after that is just empty, never a wait that does not end. This
 * computer only lists agents once Claude Code or Codex runs locally, so its empty list asks for
 * setup.
 */
export function agentSlots(
  thisComputer: boolean,
  busy: boolean,
  state: MachineState,
  agents: readonly RuntimeInstance[],
): 'starting' | 'noLocalAgent' | 'agents' {
  if (busy) return 'starting'
  if (state !== 'running' || agents.length > 0) return 'agents'

  return thisComputer ? 'noLocalAgent' : 'agents'
}

/**
 * Whether + (New runtime) shows: on any running machine, whatever the viewer's access. The backend
 * lets a teammate a machine is shared with ('use') add their own agent there, so it is not kept
 * to its managers.
 */
export function canAddAgent(state: MachineState): boolean {
  return state === 'running'
}
