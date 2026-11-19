// The model and effort a new session starts with, as the app's composer picks
// them for a first turn: only values the chosen agent offers.

import { requireRuntimeInstance } from '@/lib/claude-code-preview/runtime-catalog'
import { offeredSessionConfig } from '@/lib/claude-code-preview/session-config-catalog'
import { runtimeModelCatalog } from '@/lib/claude-code-preview/runtime-models'

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

/**
 * What a new session starts on: the agent (`runtime_id`) and its model and
 * effort. An existing session keeps its own; change those with nuphos_update_session.
 */
export async function startChoice(
  args: Record<string, unknown>,
  existing: AgentConversation | null,
  teamId: string,
  userId: string,
): Promise<{ runtimeId?: string; pick?: RuntimeDefaults } | { refused: string }> {
  const runtimeId = text(args.runtime_id)
  const pick = requestedPick(args)

  if (existing) {
    if (runtimeId && existing.runtimeId !== runtimeId)
      return {
        refused: `runtime_id only applies to a new session; ${existing.sessionId} already runs on its own.`,
      }
    if (pick)
      return {
        refused: 'model and effort apply to a new session; change them with nuphos_update_session.',
      }

    return {}
  }
  if (!runtimeId)
    return pick
      ? { refused: 'model and effort need a runtime_id: the choices depend on the agent.' }
      : {}
  const refused = await requireRuntimeInstance(teamId, runtimeId, userId).then(
    (instance) => (instance.status === 'disabled' ? 'This agent is disabled.' : null),
    (err: unknown) => {
      if (err instanceof AppError) return err.message
      throw err
    },
  )

  if (refused) return { refused }
  if (!pick) return { runtimeId }
  const offered = await offeredPick(teamId, runtimeId, userId, pick)

  return 'refused' in offered ? offered : { runtimeId, pick: offered.pick }
}
