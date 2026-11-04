import { t } from '../i18n/index.ts'

import type { AgentDevice } from '../api/device-types'
import type { RuntimeInstance } from '../types/runtime'

/** A local agent runs on its owner's own computer (`local_<user>_<device>`). */
export function isLocalAgentRuntime(runtimeId: string | undefined): boolean {
  return runtimeId?.startsWith('local_') === true
}

/** People in a session reply while they may use its computer, so a move can take that away. */
export const OWN_LOCAL_AGENT_MOVE_NOTICE = t(
  'After the move, people you shared it with can reply only if they can use this computer; the others can still read it.',
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
    return t(
      'Its owner can see this work. People you shared it with can reply only if they can use this computer.',
    )
  if (target.local?.box) return undefined

  return OWN_LOCAL_AGENT_MOVE_NOTICE
}
