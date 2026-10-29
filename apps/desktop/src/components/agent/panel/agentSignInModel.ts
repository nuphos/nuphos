import type { Message } from './model.ts'
import type { RuntimeInstance } from '../../../types/runtime.ts'
import type { TeamMember } from '../../../types/team.ts'

/** How a signed-out agent gets signed in again, from where the viewer sits. */
export type SignInRoute =
  /** This computer's agent: its own CLI sign-in. */
  | { kind: 'cli'; provider: 'claude-code' | 'codex' }
  /** The runtime sign-in the viewer may start for exactly this agent. */
  | { kind: 'dialog'; instance: RuntimeInstance }
  /** Someone else signs it in; `name` is null until the team's members load. */
  | { kind: 'ask'; name: string | null }
  /** Nothing to start from here: the card's own guidance stands. */
  | { kind: 'none' }

/** The user a computer's agent belongs to: its id is `local_<userId>_<deviceId>…`. */
export function localRuntimeOwner(runtimeId: string | undefined): string | undefined {
  if (!runtimeId?.startsWith('local_')) return undefined

  return runtimeId.slice('local_'.length).split('_')[0] || undefined
}

/**
 * Mirrors the backend's rule: a team's agent is signed in by an administrator, a
 * member's own computer or Box by that member only.
 */
export function signInRoute({
  runtimeId,
  viewerId,
  isTeamAdmin,
  onThisComputer,
  instance,
  members,
}: {
  runtimeId: string | undefined
  viewerId: string | undefined
  isTeamAdmin: boolean
  onThisComputer: boolean
  instance: RuntimeInstance | undefined
  members: TeamMember[] | null
}): SignInRoute {
  if (!runtimeId) return { kind: 'none' }
  // Grok Build and OpenCode sign in from Agent settings, not through their own CLI here.
  if (onThisComputer)
    return /_(grok|opencode)$/u.test(runtimeId)
      ? { kind: 'none' }
      : { kind: 'cli', provider: runtimeId.endsWith('_codex') ? 'codex' : 'claude-code' }
  const owner = localRuntimeOwner(runtimeId)

  if (owner) {
    if (owner !== viewerId) return { kind: 'ask', name: memberName(members, owner) }

    return instance ? { kind: 'dialog', instance } : { kind: 'none' }
  }
  if (!isTeamAdmin) return { kind: 'ask', name: adminName(members) }

  return instance && (instance.kind === 'managed' || instance.kind === 'external')
    ? { kind: 'dialog', instance }
    : { kind: 'none' }
}

function memberName(members: TeamMember[] | null, id: string): string | null {
  return members?.find((member) => member.id === id)?.name ?? null
}

/** The longest-standing administrator: usually whoever set the team up. */
function adminName(members: TeamMember[] | null): string | null {
  const admins = (members ?? [])
    .filter((member) => member.role === 'ADMINISTRATOR' && !member.removedAt)
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))

  return admins[0]?.name ?? null
}

/** The text of the last message you sent, to send again once the agent is signed in. */
export function lastSentText(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]

    if (message.role !== 'user') continue
    if (message.turnKind === 'plan-approval') return null
    const text = message.parts
      .map((part) => (part.type === 'text' ? (part as { text: string }).text : ''))
      .join('')
      .trim()

    return text || null
  }

  return null
}
