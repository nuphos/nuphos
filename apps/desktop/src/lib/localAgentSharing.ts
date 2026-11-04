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
export const LOCAL_AGENT_SHARING_NOTE = t(
  'People you share this with can read it, but only you can send messages.',
)

export const OWN_LOCAL_AGENT_MOVE_NOTICE = t(
  'After the move, only you can send messages; people you shared it with can still read it.',
)

/** Host trust and losing collaboration are separate reasons to explain a move. */
export function localAgentMoveWarning(
  target: Pick<RuntimeInstance, 'kind' | 'local'>,
  access?: AgentDevice['access'],
  viewerUserId?: string,
): string | undefined {
  if (target.kind !== 'local') return undefined
  const own =
    access === 'owner' ||
    access === 'manage' ||
    (viewerUserId !== undefined && target.local?.ownerUserId === viewerUserId)

  if (!own && (access === 'use' || target.local?.shared))
    return t('Its owner can see this work, and only you can send messages in this agent.')
  if (target.local?.box) return undefined

  return OWN_LOCAL_AGENT_MOVE_NOTICE
}
