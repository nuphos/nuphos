// Memory for Claude Code preview turns. The agent searches and saves memory
// itself through its memory tools; the runtime only resolves the provider,
// collects what those tools did, and records attribution after the turn.
import { captureTurnAttribution } from '@/lib/agent/memory-slots/attribution-capture'
import { logError } from '@/lib/observability'

import { buildTurnMemoryPromise } from './chat-prep'

import type { TurnMemoryResult } from './chat-prep'

export type PreviewTurnMemory = {
  turnMemory: TurnMemoryResult
}

export async function resolvePreviewTurnMemory(args: {
  sessionId: string
  userId: string
  teamId: string
  requestId: string
}): Promise<PreviewTurnMemory> {
  const turnMemory = await buildTurnMemoryPromise({
    sessionId: args.sessionId,
    userId: args.userId,
    teamId: args.teamId,
    requestId: args.requestId,
    run: undefined,
  })

  return { turnMemory }
}

/** Post-turn memory chain (provenance → attribution); fail-open. */
export async function finishPreviewTurnMemory(args: {
  sessionId: string
  userId: string
  teamId: string
  requestId: string
  memory: PreviewTurnMemory
  emitFrame?: (frame: Record<string, unknown>) => void
}): Promise<void> {
  const { resolution, accumulator } = args.memory.turnMemory
  const view = accumulator?.view()

  if (!view) return
  const provider = resolution.kind === 'active' ? resolution.providerId : undefined

  if (args.emitFrame && view.fetchedIds.length > 0) {
    args.emitFrame({
      type: 'memory-provenance',
      sessionId: args.sessionId,
      turnKey: args.requestId,
      fetchedIds: view.fetchedIds,
      fetchedTeamIds: view.fetchedTeamIds,
      fetchedPersonalIds: view.fetchedPersonalIds,
      labels: Object.fromEntries(view.fetchedLabels),
    })
  }

  try {
    await captureTurnAttribution({
      provider,
      teamId: args.teamId,
      userId: args.userId,
      conversationId: args.sessionId,
      turnKey: args.requestId,
      fetchedTeamIds: view.fetchedTeamIds,
      fetchedPersonalIds: view.fetchedPersonalIds,
      supersededTeamIds: view.supersededTeamIds,
      supersededPersonalIds: view.supersededPersonalIds,
    })
  } catch (err) {
    logError('agent.memory.attribution_error', err, { teamId: args.teamId })
  }
}
