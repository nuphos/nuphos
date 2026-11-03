import { t } from '../i18n/index.ts'

import type { AgentDevice } from '../api/device-types'
import type { RuntimeInstance } from '../types/runtime'

/** A local agent runs on its owner's own computer (`local_<user>_<device>`). */
export function isLocalAgentRuntime(runtimeId: string | undefined): boolean {
  return runtimeId?.startsWith('local_') === true
}

/** Shown in the Share menu of a session on the owner's computer. The backend
 *  refuses a turn there from anyone but the owner (`local_runtime_owner_only`),
 *  so the people it is shared with can read it but not run anything. */
export const LOCAL_AGENT_SHARING_NOTE =
  'This agent runs on your computer’s local runtime. People you share it with can read it, but only you can send messages. Move it to a team runtime to work on it together.'

/** Explain the destination trust boundary before moving conversation context. */
export function localAgentMoveWarning(
  target: Pick<RuntimeInstance, 'kind' | 'local'>,
  access?: AgentDevice['access'],
  viewerUserId?: string,
): string | undefined {
  if (target.kind !== 'local' || !target.local) return undefined
  if (access === 'owner' || access === 'manage') return undefined
  if (!access && target.local.ownerUserId === viewerUserId) return undefined
  if (access !== 'use' && !target.local.shared && !target.local.box) return undefined

  return t('Its owner can see this work, and only you can send messages in this agent.')
}
