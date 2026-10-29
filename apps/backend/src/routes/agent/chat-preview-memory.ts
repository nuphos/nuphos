// Memory for Claude Code preview turns. The agent searches and saves memory
// itself through its memory tools; the runtime only resolves the provider,
// collects what those tools did, and records attribution after the turn.
import { captureTurnAttribution } from '@/lib/agent/memory-slots/attribution-capture'
import { runAttributionJudge } from '@/lib/agent/memory-slots/attribution-judge'
import { logError } from '@/lib/observability'

import { buildTurnMemoryPromise } from './chat-prep'
import { getUserMessageTexts } from './transcript'

import type { TurnMemoryResult } from './chat-prep'
import type { UIMessage } from 'ai'

export type PreviewTurnMemory = {
  turnMemory: TurnMemoryResult
  /** The raw latest user text — what the attribution judge must see. */
  memoryQuery: string
}

export async function resolvePreviewTurnMemory(args: {
  sessionId: string
  userId: string
  teamId: string
  requestId: string
  messages: UIMessage[]
}): Promise<PreviewTurnMemory> {
  const turnMemory = await buildTurnMemoryPromise({
    sessionId: args.sessionId,
    userId: args.userId,
    teamId: args.teamId,
    requestId: args.requestId,
    run: undefined,
  })

  return { turnMemory, memoryQuery: getUserMessageTexts(args.messages)[0] ?? '' }
}

/** Post-turn memory chain (provenance → attribution → judge); fail-open. */
export async function finishPreviewTurnMemory(args: {
  sessionId: string
  userId: string
  teamId: string
  requestId: string
  memory: PreviewTurnMemory
  answer: string
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
    await runAttributionJudge({
      provider,
      teamId: args.teamId,
      userId: args.userId,
      conversationId: args.sessionId,
      turnKey: args.requestId,
      query: args.memory.memoryQuery,
      answer: args.answer,
      fetchedLabels: view.fetchedLabels,
      fetchedPersonalIds: view.fetchedPersonalIds,
    })
  } catch (err) {
    logError('agent.memory.attribution_error', err, { teamId: args.teamId })
  }
}
