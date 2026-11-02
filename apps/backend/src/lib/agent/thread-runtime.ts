import {
  listRuntimeInstances,
  listRuntimeQuotas,
  withRuntimeReadiness,
} from '@/lib/claude-code-preview/runtime-catalog'
import { conversationSessionConfig } from '@/lib/claude-code-preview/session-config'
import { pickOf } from '@/lib/claude-code-preview/session-config-options'
import { AppError } from '@/lib/errors'

import { getConversationBySessionId } from './db'

// What a thread runs on: its agent, and the model and effort it uses there.

/**
 * The team's agents and the owner's Boxes. Never an agent on someone's own
 * computer, which only its owner can choose, with the consent the Desktop asks for.
 */
export async function threadRuntimeInstances(actor: { teamId: string; userId: string }) {
  return (await listRuntimeInstances(actor.teamId, actor.userId)).filter(
    (instance) => instance.kind !== 'local' || instance.local?.box,
  )
}

/** Those agents with each one's readiness and usage, marking the one a conversation runs on. */
export async function threadRuntimes(
  actor: { teamId: string; userId: string },
  currentRuntimeId: string | undefined,
) {
  const instances = await withRuntimeReadiness(actor.teamId, await threadRuntimeInstances(actor))
  const quotas = await listRuntimeQuotas(actor.teamId, instances)

  return {
    runtimes: instances.map((instance, i) => ({
      runtimeId: instance.id,
      label: instance.label,
      provider: instance.provider,
      kind: instance.kind,
      status: instance.status,
      ready: !instance.notReady,
      current: instance.id === currentRuntimeId,
      quota: quotas[i],
    })),
  }
}

export async function assertThreadRuntime(
  actor: { teamId: string; userId: string },
  runtimeId: string | undefined,
) {
  if (runtimeId && !(await threadRuntimeInstances(actor)).some(({ id }) => id === runtimeId))
    throw new Error(
      "A thread can only move to one of the team's agents or Boxes, not to a computer.",
    )
}

export type ThreadModelPick = { model?: string; effort?: string }

/**
 * Sets a thread's model and effort as the conversation's model picker does, so
 * the runtime's own catalog decides what is valid. The model goes first: the
 * efforts on offer depend on it. Nothing to set returns nothing.
 */
export async function setThreadModel(threadId: string, userId: string, pick: ThreadModelPick) {
  if (!pick.model && !pick.effort) return
  let options: Awaited<ReturnType<typeof conversationSessionConfig>>['options'] = []

  for (const configId of ['model', 'effort'] as const) {
    const value = pick[configId]

    if (!value) continue
    const conversation = await getConversationBySessionId(threadId)

    if (!conversation) throw new Error('Thread not found.')
    try {
      ;({ options } = await conversationSessionConfig(conversation, { configId, value }, userId))
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'invalid_runtime_config') throw error
      const offered = (await conversationSessionConfig(conversation, undefined, userId)).options
      const choices = offered.find((option) => option.kind === configId)?.options ?? []

      throw new Error(
        `${configId} "${value}" is not offered by the thread's agent. Choose one of: ${
          choices.map((choice) => choice.value).join(', ') || 'none'
        }.`,
        { cause: error },
      )
    }
  }

  return pickOf(options)
}
