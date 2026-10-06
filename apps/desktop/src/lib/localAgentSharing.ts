import type { RuntimeInstance } from '../types/runtime'

/** A local agent runs on its owner's own computer (`local_<user>_<device>`). */
export function isLocalAgentRuntime(runtimeId: string | undefined): boolean {
  return runtimeId?.startsWith('local_') === true
}

/** Shown in the Share menu of a session on the owner's computer. Every current
 *  team member may reply to a team session, not only its participants, and
 *  every reply runs on that computer. */
export const LOCAL_AGENT_SHARING_WARNING =
  'This session runs on your computer’s Local Agent. Anyone in this team can open it and run commands on your computer.'

/** The consent a move needs before it puts the session on a computer. It does
 *  not depend on who has joined: the whole team can reply once it is there. */
export function localAgentMoveWarning(target: Pick<RuntimeInstance, 'kind'>): string | undefined {
  return target.kind === 'local'
    ? 'This agent runs on your computer. After the move, anyone in this team can open this session and run commands on your computer.'
    : undefined
}
