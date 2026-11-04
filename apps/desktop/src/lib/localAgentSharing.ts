import { t } from '../i18n/index.ts'

import type { ConversationMoveCheck } from '../api/agent-types'
import type { AgentDevice } from '../api/device-types'
import type { RuntimeInstance } from '../types/runtime'

/** A local agent runs on its owner's own computer (`local_<user>_<device>`). */
export function isLocalAgentRuntime(runtimeId: string | undefined): boolean {
  return runtimeId?.startsWith('local_') === true
}

/**
 * Moving onto someone else's computer lets its owner see the work. Who in the
 * conversation would lose reply is the move dialog's to list (moveNotice).
 */
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

  return !own && (access === 'use' || target.local?.shared)
    ? t('Its owner can see this work.')
    : undefined
}

/**
 * Why a move asks first: the target's owner can see the work, or teammates in
 * the conversation cannot use the target computer, and would lose reply unless
 * the mover gives them use of it. Undefined when there is nothing to say.
 */
export function moveNotice(
  target: Pick<RuntimeInstance, 'label'>,
  hostTrust: string | undefined,
  check: ConversationMoveCheck | null,
): string | undefined {
  const losing = check?.losing ?? []
  const names = losing.map((person) => person.name).join(', ')
  const computer = check?.computer?.label ?? target.label
  const teammates =
    losing.length === 0
      ? undefined
      : check?.canGrant
        ? t(
            'Moving this conversation will give these teammates use of {computer}: {names}. Continue?',
            {
              computer,
              names,
            },
          )
        : t(
            '{names} can’t use {computer}, so after the move they can only view this conversation.',
            {
              computer,
              names,
            },
          )

  return [hostTrust, teammates].filter(Boolean).join(' ') || undefined
}
