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

export const OWN_LOCAL_AGENT_MOVE_NOTICE = t(
  'After the move, only you can send messages; people you shared it with can still read it.',
)

const OPEN_AGENT_MENU = 'nuphos:open-agent-menu'

/** Opens the agent picker in this session's composer, e.g. from the Share card. */
export function openAgentMenu(sessionId: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_AGENT_MENU, { detail: sessionId }))
}

export function onOpenAgentMenu(sessionId: string, open: () => void): () => void {
  const listener = (event: Event) => {
    if ((event as CustomEvent<string>).detail === sessionId) open()
  }

  window.addEventListener(OPEN_AGENT_MENU, listener)

  return () => window.removeEventListener(OPEN_AGENT_MENU, listener)
}

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
