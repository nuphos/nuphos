// Memory agent tools (§17.5–17.6 + personal-layer spec: ADR-0004 minimal
// surface + ADR-0005 default-enabled). Exactly two model-facing tools —
// save_memory and memory_get — with scope selecting the write path, never
// separate tools per scope. Both scopes publish immediately: memories are
// default-enabled, and control is post-hoc (inspect / soft-delete in the
// Memories view) rather than a pre-publish confirmation pause. Team writes
// still require EDITOR+ and record a proposal→published pair for
// audit/idempotency. No automatic writes exist.

import { logError } from '@/lib/observability'

import { createMemoryGetTool } from './tools-get'
import { createSaveMemoryTool } from './tools-save'

import type {
  MemoryFetchedObserver,
  MemorySavedItemObserver,
  MemorySearchedObserver,
  MemorySupersededObserver,
} from './tools-shared'
import type { AgentSessionOrigin } from '../tools-triggers'

export function createTeamMemoryTools(ctx: {
  userId: string
  teamId: string | null | undefined
  conversationId: string
  origin?: AgentSessionOrigin
  // Semantic save event (Phase 2): the item/scope pair of a landed save. The
  // SPI adapter derives its MemorySavedEvent (real doc timestamps included)
  // from this; the RUNTIME renders the wire memory-ingest frame — the tool
  // layer no longer builds frames itself.
  onMemorySavedItem?: MemorySavedItemObserver
  // Provenance (ADR-0005): fired on every successful memory_get — the
  // usage-telemetry signal since team_memory_mark was removed. `label` is the
  // one-line content snapshot the runtime keeps for the attribution judge
  // (A4①: snapshot at fetch time, never re-read from the store).
  onMemoryFetched?: MemoryFetchedObserver
  // Track A 2.1: fired when a save_memory supersede lands — the OLD memory id.
  // The runtime turns this into a supersede_correction attribution signal
  // (the first negative usefulness signal: "was corrected", not just "was used").
  onMemorySuperseded?: MemorySupersededObserver
  // GAP 3 (ADR-0008): the query text behind each search + what it found.
  // A zh query that matches nothing produces silence, never a
  // fetch-then-reject — this is the only signal that can see it.
  onMemorySearched?: MemorySearchedObserver
  // Active plan of the saving conversation, resolved AT SAVE TIME (async so
  // the caller can query live state — a turn-start snapshot goes stale when
  // plans are created or completed mid-turn). Stamped into the case so
  // the evidence chain records which plan's verification steps produced it.
  getActivePlanId?: () => Promise<string | null>
}): Record<string, unknown> {
  const {
    userId,
    teamId,
    conversationId,
    origin = 'user',
    onMemorySavedItem: rawOnMemorySavedItem,
    onMemoryFetched: rawOnMemoryFetched,
    onMemorySuperseded: rawOnMemorySuperseded,
    onMemorySearched: rawOnMemorySearched,
    getActivePlanId,
  } = ctx

  // Observers are SSE/telemetry side-channels and often fire AFTER the write
  // has committed — a closed stream or throwing sink must never turn a
  // successful memory operation into a tool error (review: fail-open).
  const failOpen = <TArgs extends unknown[]>(
    event: string,
    observer: ((...args: TArgs) => void) | undefined,
  ): ((...args: TArgs) => void) | undefined =>
    observer &&
    ((...args: TArgs) => {
      try {
        void Promise.resolve(observer(...args)).catch((err: unknown) => {
          logError(event, err)
        })
      } catch (err) {
        logError(event, err)
      }
    })
  const onMemorySavedItem = failOpen('memory.observer.saved_failed', rawOnMemorySavedItem)
  const onMemoryFetched = failOpen('memory.observer.fetched_failed', rawOnMemoryFetched)
  const onMemorySuperseded = failOpen('memory.observer.superseded_failed', rawOnMemorySuperseded)
  const onMemorySearched = failOpen('memory.observer.searched_failed', rawOnMemorySearched)

  return {
    save_memory: createSaveMemoryTool({
      userId,
      teamId,
      conversationId,
      origin,
      onMemorySavedItem,
      onMemorySuperseded,
      getActivePlanId,
    }),
    memory_get: createMemoryGetTool({
      conversationId,
      userId,
      teamId,
      onMemoryFetched,
      onMemorySearched,
    }),
  }
}
