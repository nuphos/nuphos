import { t } from '../../../i18n/index.ts'
import { quotaSignedOut } from '../../../lib/runtimeQuota.ts'

import { localRuntimeOwner, signInRoute } from './agentSignInModel.ts'

import type { RuntimeInstance, RuntimeQuota } from '../../../types/runtime'
import type { TeamMember } from '../../../types/team'

/** The one thing the picker offers to get an agent working again. */
export type AgentFix =
  /** The runtime sign-in for exactly this agent. */
  | { kind: 'signIn'; instance: RuntimeInstance }
  /** This computer's agent: its own CLI sign-in. */
  | { kind: 'cli'; provider: 'claude-code' | 'codex' }
  /** The viewer's own paused Box. */
  | { kind: 'resume'; deviceId: string }
  /** An offline computer: look again. */
  | { kind: 'retry' }
  /** Someone else fixes it; `name` is null until the team's members load. */
  | { kind: 'ask'; name: string | null }
  /** Nothing to start from here: Agent settings has it. */
  | { kind: 'settings' }

export type AgentProblem = {
  reason: string
  fix: AgentFix
  /** False when a turn would fail anyway, so the row starts the fix instead of picking it. */
  pickable: boolean
}

export type AgentRowViewer = {
  viewerId: string | undefined
  isTeamAdmin: boolean
  /** Whether the agent runs on the computer this window is on. */
  onThisComputer: (instance: RuntimeInstance) => boolean
  members: TeamMember[] | null
}

/** What stops this agent taking a turn, and its fix; null when it is ready. */
export function agentProblem(
  instance: RuntimeInstance,
  quota: RuntimeQuota | undefined,
  viewer: AgentRowViewer,
): AgentProblem | null {
  const { local } = instance

  if (local?.online === false) {
    const paused = local.box?.state === 'paused'
    const reason = paused ? t('Paused') : t('Offline')

    if (!paused) return { reason, fix: { kind: 'retry' }, pickable: false }
    if (local.ownerUserId === viewer.viewerId)
      return { reason, fix: { kind: 'resume', deviceId: local.deviceId }, pickable: false }

    return { reason, fix: { kind: 'ask', name: ownerName(instance, viewer) }, pickable: false }
  }
  // The usage probe's sign-in hint is a guess (a token in the environment reads the same),
  // so it offers the fix but never stops the agent being picked.
  const signedOut = local?.signedIn === false

  if (!signedOut && !quotaSignedOut(quota)) return null
  const route = signInRoute({
    runtimeId: instance.id,
    viewerId: viewer.viewerId,
    isTeamAdmin: viewer.isTeamAdmin,
    onThisComputer: viewer.onThisComputer(instance),
    instance,
    members: viewer.members,
  })
  const fix: AgentFix =
    route.kind === 'cli'
      ? { kind: 'cli', provider: route.provider }
      : route.kind === 'dialog'
        ? { kind: 'signIn', instance: route.instance }
        : route.kind === 'ask'
          ? { kind: 'ask', name: route.name }
          : // Grok Build and OpenCode on your own computer: the runtime sign-in, as in settings.
            local?.ownerUserId === viewer.viewerId
            ? { kind: 'signIn', instance }
            : { kind: 'settings' }

  return { reason: t('Signed out'), fix, pickable: !signedOut }
}

function ownerName(instance: RuntimeInstance, viewer: AgentRowViewer): string | null {
  const owner = instance.local?.ownerUserId ?? localRuntimeOwner(instance.id)

  return viewer.members?.find((member) => member.id === owner)?.name ?? null
}

/** The fix's button text; null for "ask", which is said, not clicked. */
export function agentFixLabel(fix: AgentFix): string | null {
  if (fix.kind === 'signIn' || fix.kind === 'cli') return t('Sign in')
  if (fix.kind === 'resume') return t('Resume')
  if (fix.kind === 'retry') return t('Retry')
  if (fix.kind === 'settings') return t('Open settings')

  return null
}

/** "Ask <name>" for a fix only someone else can make. */
export function agentAskText(fix: Extract<AgentFix, { kind: 'ask' }>): string {
  return fix.name ? t('Ask {name}', { name: fix.name }) : t('Ask an administrator')
}
