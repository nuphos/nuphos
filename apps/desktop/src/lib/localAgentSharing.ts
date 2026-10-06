/** A local agent runs on its owner's own computer (`local_<user>_<device>`). */
export function isLocalAgentRuntime(runtimeId: string | undefined): boolean {
  return runtimeId?.startsWith('local_') === true
}

/** Shown in the Share menu of a session on the owner's computer: any teammate
 *  can reply, and every reply runs on that computer. */
export const LOCAL_AGENT_SHARING_WARNING =
  'This session runs on your computer’s Local Agent. Teammates in this session can run commands on your computer.'
