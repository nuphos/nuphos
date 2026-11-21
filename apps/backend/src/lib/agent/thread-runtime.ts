import { authRefusedRuntimes } from '@/lib/claude-code-preview/runtime-auth-refusal'
import {
  listRuntimeInstances,
  listRuntimeQuotas,
  withRuntimeReadiness,
} from '@/lib/claude-code-preview/runtime-catalog'
import { runtimeModelCatalog } from '@/lib/claude-code-preview/runtime-models'
import { runtimeLabel } from '@/lib/claude-code-preview/runtime-provider'
import { conversationSessionConfig } from '@/lib/claude-code-preview/session-config'
import { pickOf, storedPick } from '@/lib/claude-code-preview/session-config-options'
import { AppError } from '@/lib/errors'

import { getConversationBySessionId } from './db'
import { liveAttachment } from './db/shared'

import type { AgentConversation } from './db'
import type { SettingsChangeBy } from './db/settings-history'
import type { RuntimeInstance } from '@/lib/claude-code-preview/runtime-instances'

// What a thread runs on: its agent, and the model and effort it uses there.

/**
 * Why a thread cannot run on an agent the owner can see: a teammate's computer
 * shows its owner the work, which only the conversation owner can agree to, in the
 * Desktop; a signed-out agent's turns are refused (resolveLocalRuntimeEndpoint); and
 * one whose provider refused its sign-in on its last turn would fail the same way.
 */
export function unavailableReason(
  instance: Pick<RuntimeInstance, 'provider' | 'local'>,
  authRefused = false,
) {
  if (instance.local?.shared)
    return "A teammate's computer: its owner can see the work, so only you can move a conversation there, from the Desktop."
  if (instance.local?.signedIn === false)
    return `Signed out: sign in to ${runtimeLabel(instance.provider)} on that computer first.`

  return authRefused
    ? `Sign-in refused: ${runtimeLabel(instance.provider)} refused this agent's sign-in on its last turn. Sign it in again first.`
    : undefined
}

/** How long one agent's model list may take before the listing goes on without it. */
const MODELS_WAIT_MS = 8_000

/** The models a ready agent offers, or nothing when it cannot say in time. */
async function offeredModels(actor: { teamId: string; userId: string }, runtimeId: string) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      resolve(null)
    }, MODELS_WAIT_MS)
  })

  try {
    return await Promise.race([
      runtimeModelCatalog(actor.teamId, runtimeId, undefined, actor.userId).then(
        ({ models }) => models,
        () => null,
      ),
      late,
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Those agents with each one's readiness, usage and models, marking the one a
 * conversation runs on: what a delegating agent needs to pick a model.
 */
export async function threadRuntimes(
  actor: { teamId: string; userId: string },
  currentRuntimeId: string | undefined,
) {
  const instances = await withRuntimeReadiness(
    actor.teamId,
    await listRuntimeInstances(actor.teamId, actor.userId),
  )
  const [quotas, models, refused] = await Promise.all([
    listRuntimeQuotas(actor.teamId, instances),
    Promise.all(
      instances.map(async (instance) =>
        instance.notReady ? null : offeredModels(actor, instance.id),
      ),
    ),
    authRefusedRuntimes(actor.teamId),
  ])

  return {
    runtimes: instances.map((instance, i) => {
      const unavailable = unavailableReason(instance, refused.has(instance.id))

      return {
        runtimeId: instance.id,
        label: instance.label,
        provider: instance.provider,
        kind: instance.kind,
        status: instance.status,
        ready: !instance.notReady && !unavailable,
        ...(unavailable ? { unavailable } : {}),
        current: instance.id === currentRuntimeId,
        quota: quotas[i],
        // Up front, so an agent sees it before moving to an account that ran out too.
        ...(quotas[i]?.sharesQuotaWith ? { sharesQuotaWith: quotas[i]?.sharesQuotaWith } : {}),
        ...(models[i]?.length ? { models: models[i] } : {}),
      }
    }),
  }
}

/** The agent a thread was asked to run on, refused unless a thread may run there. */
export async function assertThreadRuntime(
  actor: { teamId: string; userId: string },
  runtimeId: string | undefined,
) {
  if (!runtimeId) return
  const runtime = (await listRuntimeInstances(actor.teamId, actor.userId)).find(
    ({ id }) => id === runtimeId,
  )

  if (!runtime) throw new Error('No such agent. Call list_agent_runtimes for the ones you can use.')
  const unavailable = unavailableReason(
    runtime,
    (await authRefusedRuntimes(actor.teamId)).has(runtimeId),
  )

  if (unavailable) throw new Error(unavailable)

  return runtime
}

export type ThreadModelPick = { model?: string; effort?: string; fast?: string }

/** The model, effort and fast mode a conversation runs with: what a thread it starts begins on. */
export function currentPick(conversation: AgentConversation): ThreadModelPick {
  const attachment = liveAttachment(conversation)
  const { model, ...settings } = attachment
    ? storedPick(attachment)
    : (conversation.initialSessionConfig ?? {})

  // A session on Claude Code's "Default" reports `default`, which no catalog
  // lists: it means the agent's default, what a session given no model runs.
  return model && model !== 'default' ? { ...settings, model } : settings
}

/**
 * Sets a thread's model, effort and fast mode as the conversation's model picker
 * does, so the runtime's own catalog decides what is valid. The model goes first:
 * the efforts and speeds on offer depend on it. Nothing to set returns nothing.
 */
export async function setThreadModel(
  threadId: string,
  userId: string,
  pick: ThreadModelPick,
  by: SettingsChangeBy,
) {
  if (!pick.model && !pick.effort && !pick.fast) return
  let options: Awaited<ReturnType<typeof conversationSessionConfig>>['options'] = []

  for (const configId of ['model', 'effort', 'fast'] as const) {
    const value = pick[configId]

    if (!value) continue
    const conversation = await getConversationBySessionId(threadId)

    if (!conversation) throw new Error('Thread not found.')
    try {
      ;({ options } = await conversationSessionConfig(
        conversation,
        { configId, value },
        userId,
        by,
      ))
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
