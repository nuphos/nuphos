// What a new session starts with, as the app's composer picks it for a first
// turn: the agent and only the model and effort it offers, Full Access, and
// the Bot it starts under.

import { agentConversations, getConversationBySessionId } from '@/lib/agent/db'
import { currentPick } from '@/lib/agent/thread-runtime'
import { requireRuntimeInstance } from '@/lib/claude-code-preview/runtime-catalog'
import { runtimeModelCatalog } from '@/lib/claude-code-preview/runtime-models'
import { offeredSessionConfig } from '@/lib/claude-code-preview/session-config-catalog'
import { AppError } from '@/lib/errors'

import type { AgentConversation } from '@/lib/agent/db'
import type { RuntimeDefaults } from '@/lib/claude-code-preview/openab-acp-session'

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : '')

/** The model and effort the arguments ask for, or undefined when they name none. */
function requestedPick(args: Record<string, unknown>): RuntimeDefaults | undefined {
  const pick = {
    ...(text(args.model) ? { model: text(args.model) } : {}),
    ...(text(args.effort) ? { effort: text(args.effort) } : {}),
  }

  return Object.keys(pick).length ? pick : undefined
}

/** The pick when the agent offers all of it, else why not, with its choices. */
async function offeredPick(
  teamId: string,
  runtimeId: string,
  userId: string,
  pick: RuntimeDefaults,
): Promise<{ pick: RuntimeDefaults } | { refused: string }> {
  const { options, kept } = await offeredSessionConfig(
    (model) => runtimeModelCatalog(teamId, runtimeId, model, userId),
    pick,
    true,
  )
  const missing = Object.keys(pick).filter((key) => !(key in kept))

  if (!missing.length) return { pick: kept }

  return {
    refused: missing
      .map((key) => {
        const choices = options.find((option) => option.id === key)?.options ?? []

        return choices.length
          ? `${key} "${String(pick[key as keyof RuntimeDefaults])}" is not offered by this agent. Choose one of: ${choices.map((c) => c.value).join(', ')}.`
          : `This agent does not offer a ${key} choice.`
      })
      .join(' '),
  }
}

export type StartChoice = {
  runtimeId?: string
  pick?: RuntimeDefaults
  /** Full Access for the new session, which its caller owns as in the app. */
  fullAccess?: boolean
  /** The caller's Bot the new session starts under, as its Task. */
  bot?: AgentConversation
}

/** One of the caller's own Bots in the team: a Task takes credentials and mode from its owner's Bot only. */
async function ownBot(
  sessionId: string,
  teamId: string,
  userId: string,
): Promise<AgentConversation | null> {
  const bot = await getConversationBySessionId(sessionId)

  return bot?.avatar && bot.kind !== 'channel' && bot.userId === userId && bot.teamId === teamId
    ? bot
    : null
}

/**
 * The caller's most recent standalone Task in the team: a new chat in the app
 * starts on the agent, model and effort of the last one a message was sent in.
 */
async function lastStandalone(teamId: string, userId: string) {
  return await agentConversations().findOne(
    {
      userId,
      teamId,
      parentSessionId: { $exists: false },
      avatar: { $exists: false },
      kind: { $ne: 'channel' },
      runtimeId: { $exists: true },
    },
    { sort: { lastActiveAt: -1 } },
  )
}

/** The runtime check and model pick for a new session on `runtimeId`. */
async function onRuntime(
  teamId: string,
  runtimeId: string,
  userId: string,
  pick: RuntimeDefaults | undefined,
): Promise<{ runtimeId: string; pick?: RuntimeDefaults } | { refused: string }> {
  const refused = await requireRuntimeInstance(teamId, runtimeId, userId).then(
    (instance) => (instance.status === 'disabled' ? 'This agent is disabled.' : null),
    (err: unknown) => {
      if (err instanceof AppError) return err.message
      throw err
    },
  )

  if (refused) return { refused }
  if (!pick || !Object.values(pick).some(Boolean)) return { runtimeId }
  const offered = await offeredPick(teamId, runtimeId, userId, pick)

  return 'refused' in offered ? offered : { runtimeId, pick: offered.pick }
}

/**
 * What a new session starts on: the agent (`runtime_id`) and its model and
 * effort, Full Access, or a Bot (`parent_session_id`) whose agent, model and
 * effort it starts on and whose credentials and mode it uses. Otherwise it
 * starts as a new Task in the app does: with Full Access, on the agent, model
 * and effort of the caller's last standalone Task. An existing session keeps
 * its own; change those with nuphos_update_session.
 */
export async function startChoice(
  args: Record<string, unknown>,
  existing: AgentConversation | null,
  teamId: string,
  userId: string,
): Promise<StartChoice | { refused: string }> {
  const runtimeId = text(args.runtime_id)
  const pick = requestedPick(args)
  const fullAccess = typeof args.full_access === 'boolean' ? args.full_access : undefined
  const parentId = text(args.parent_session_id)

  if (existing) {
    if (runtimeId && existing.runtimeId !== runtimeId)
      return {
        refused: `runtime_id only applies to a new session; ${existing.sessionId} already runs on its own.`,
      }
    if (pick)
      return {
        refused: 'model and effort apply to a new session; change them with nuphos_update_session.',
      }
    if (fullAccess !== undefined)
      return {
        refused: 'full_access applies to a new session; change it with nuphos_update_session.',
      }
    if (parentId) return { refused: 'parent_session_id applies to a new session only.' }

    return {}
  }
  const bot = parentId ? await ownBot(parentId, teamId, userId) : undefined

  if (bot === null)
    return {
      refused: `parent_session_id must be one of your Bots in this team; ${parentId} is not. See nuphos_list_sessions (bot: true).`,
    }
  if (bot && fullAccess !== undefined)
    return {
      refused:
        "A Task under a Bot runs in its Bot's permission mode. Change Full Access on the Bot.",
    }
  const base = bot ? { bot } : { fullAccess: fullAccess ?? true }
  // Naming none of its own: the Bot's agent, model and effort, else the last Task's.
  const from = runtimeId || pick ? undefined : (bot ?? (await lastStandalone(teamId, userId)))

  if (from?.runtimeId) {
    const inherited = await onRuntime(teamId, from.runtimeId, userId, currentPick(from))

    if (!('refused' in inherited)) return { ...inherited, ...base }
    // A model its agent no longer offers leaves the session on that agent's
    // defaults; an agent the caller can no longer use, on their default agent.
    const plain = await onRuntime(teamId, from.runtimeId, userId, undefined)

    return 'refused' in plain ? base : { ...plain, ...base }
  }
  if (!runtimeId)
    return pick
      ? { refused: 'model and effort need a runtime_id: the choices depend on the agent.' }
      : base
  const start = await onRuntime(teamId, runtimeId, userId, pick)

  return 'refused' in start ? start : { ...start, ...base }
}
