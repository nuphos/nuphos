import type { RuntimeInstance } from '../types/runtime'

/** A local agent runs on its owner's own computer (`local_<user>_<device>`). */
export function isLocalAgentRuntime(runtimeId: string | undefined): boolean {
  return runtimeId?.startsWith('local_') === true
}

/** Shown in the Share menu of a session on the owner's computer. The backend
 *  refuses a turn there from anyone but the owner (`local_runtime_owner_only`),
 *  so the people it is shared with can read it but not run anything. */
export const LOCAL_AGENT_SHARING_NOTE =
  'This session runs on your computer’s Local Agent. People you share it with can read it, but only you can send messages. Move it to a team agent to work on it together.'

/** The confirmation a move needs before it puts the session on a computer:
 *  from then on only the owner can send messages, so anyone who could reply
 *  before is left read-only. */
export function localAgentMoveWarning(target: Pick<RuntimeInstance, 'kind'>): string | undefined {
  return target.kind === 'local'
    ? 'This agent runs on your computer. After the move, only you can send messages in this session. People you shared it with can still read it.'
    : undefined
}
