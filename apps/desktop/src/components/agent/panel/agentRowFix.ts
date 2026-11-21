import { t } from '../../../i18n/index.ts'
import { quotaSignedOut } from '../../../lib/runtimeQuota.ts'

import { signInRoute } from './agentSignInModel.ts'
import { pausedBoxLabel } from './runtimeControlSignOut.ts'

import type { RuntimeInstance, RuntimeQuota } from '../../../types/runtime'
import type { TeamMember } from '../../../types/team'

/** The one thing the picker offers to get an agent working again. */
export type AgentFix =
  /** The runtime sign-in for exactly this agent. */
  | { kind: 'signIn'; instance: RuntimeInstance }
  /** This computer's agent: its own CLI sign-in. */
  | { kind: 'cli'; provider: 'claude-code' | 'codex' }
  /** An offline computer: look again. */
  | { kind: 'retry' }
  /**
   * Someone else fixes it; `name` is null until the team's members load. `runtimeId` is set
   * for a sign-in, which a conversation can ask them for.
   */
  | { kind: 'ask'; name: string | null; runtimeId?: string }
  /** Nothing to start from here: Agent settings has it. */
  | { kind: 'settings' }

export type AgentProblem = {
  reason: string
  /** Absent when the state says itself and there is nothing worth pressing, as for a paused Box. */
  fix?: AgentFix
  /** False when a turn would fail anyway, so the row starts the fix instead of picking it. */
  pickable: boolean
}

export type AgentRowViewer = {
  viewerId: string | undefined
  isTeamAdmin: boolean
  /** Whether the agent runs on the computer this window is on. */
  onThisComputer: (instance: RuntimeInstance) => boolean
  members: TeamMember[] | null
  /** Whether the viewer manages a computer, so signs its agents in themselves. */
  manages?: (deviceId: string) => boolean
}

/** What stops this agent taking a turn, and its fix; null when it is ready. */
export function agentProblem(
  instance: RuntimeInstance,
  quota: RuntimeQuota | undefined,
  viewer: AgentRowViewer,
): AgentProblem | null {
  const { local } = instance

  if (local?.online === false) {
    // A Box that is away is parked, not lost: the composer already says the send brings it
    // back (pausedBoxLabel), so the row says the same word and offers nothing to press.
    if (pausedBoxLabel(local) !== null) return { reason: t('Paused'), pickable: false }

    return { reason: t('Offline'), fix: { kind: 'retry' }, pickable: false }
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
    manages: viewer.manages,
  })
  const fix: AgentFix =
    route.kind === 'cli'
      ? { kind: 'cli', provider: route.provider }
      : route.kind === 'dialog'
        ? { kind: 'signIn', instance: route.instance }
        : route.kind === 'ask'
          ? { kind: 'ask', name: route.name, runtimeId: instance.id }
          : // Grok Build and OpenCode on your own computer: the runtime sign-in, as in settings.
            local?.ownerUserId === viewer.viewerId
            ? { kind: 'signIn', instance }
            : { kind: 'settings' }

  return { reason: t('Signed out'), fix, pickable: !signedOut }
}

/** The fix's button text; null for "ask", which is said, not clicked. */
export function agentFixLabel(fix: AgentFix): string | null {
  if (fix.kind === 'signIn' || fix.kind === 'cli') return t('Sign in')
  if (fix.kind === 'retry') return t('Retry')
  if (fix.kind === 'settings') return t('Open settings')

  return null
}

/** "Ask <name>" for a fix only someone else can make. */
export function agentAskText(fix: Extract<AgentFix, { kind: 'ask' }>): string {
  return fix.name ? t('Ask {name}', { name: fix.name }) : t('Ask an administrator')
}
