// A turn that ends on a tool call nobody ever answered is stranded: the user
// sees a spinning tool card (or "Continuing…") forever, and every layer stays
// silent about it — the model finished, the stream closed cleanly, no error was
// raised anywhere. Two client bugs of this shape survived three rounds of fixes
// because nothing was counting them. This probe counts them.
//
// It is deliberately a periodic query rather than an in-request check: the
// failure is the ABSENCE of a follow-up request, which no request can observe.
import { agentConversations, agentMessages } from '@/lib/agent/db'
import {
  CLIENT_SIDE_TOOLS,
  PROBE_INTERVAL_MS,
  probeWindow,
  strandedToolCalls,
  turnHasText,
} from '@/lib/agent/stuck-turn-shape'
import { logError, logEvent } from '@/lib/observability'

export async function scanForStuckTurns(now = Date.now()): Promise<number> {
  const { from, to } = probeWindow(now)
  const candidates = await agentConversations()
    .find(
      { lastActiveAt: { $gte: from, $lt: to } },
      { projection: { sessionId: 1, userId: 1, teamId: 1, lastActiveAt: 1 } },
    )
    .toArray()

  let stranded = 0

  for (const c of candidates) {
    // Keyed by sessionId alone, not the conversation's userId: the transcript
    // writer stamps messages with the ACTING user, and a teammate's turn in a
    // shared conversation would then hide behind an owner-scoped read — the
    // stranded turn we most want to see is the one someone else was watching.
    const last = await agentMessages()
      .find({ sessionId: c.sessionId }, { sort: { index: -1 }, limit: 1 })
      .toArray()
    const message = last[0]

    if (!message || message.role !== 'assistant') continue
    const parts = message.parts ?? []
    const tools = strandedToolCalls(parts)

    if (tools.length === 0) continue
    stranded += 1
    logEvent('warn', 'agent.stuck_turn.detected', {
      session_id: c.sessionId,
      user_id: c.userId,
      team_id: c.teamId ?? null,
      tool_names: tools.join(','),
      pending_tool_count: tools.length,
      // Which recovery path failed: the desktop executing a local tool, or the
      // client re-submitting the turn after a server-side call.
      client_tool: tools.some((t) => CLIENT_SIDE_TOOLS.has(t)),
      has_text: turnHasText(parts),
      stranded_ms: now - c.lastActiveAt.getTime(),
      message_index: message.index,
    })
  }

  // Always emitted, so the dashboard can show a real zero rather than an
  // absence that could equally mean the probe stopped running.
  logEvent('info', 'agent.stuck_turn.probe_completed', {
    scanned: candidates.length,
    stranded,
    window_from: from.toISOString(),
    window_to: to.toISOString(),
  })

  return stranded
}

let warmupTimer: ReturnType<typeof setTimeout> | undefined
let probeTimer: ReturnType<typeof setInterval> | undefined

/** Runs on every replica: the scan is read-only and each run reports its own
 *  window, so concurrent replicas duplicate log lines but never miss or
 *  double-count a turn within one replica's stream. Dedupe in the alert rule if
 *  replica count starts to matter. */
export function initStuckTurnProbe(): void {
  const run = () =>
    void scanForStuckTurns().catch((err: unknown) => {
      logError('agent.stuck_turn.probe_failed', err)
    })

  warmupTimer = setTimeout(run, 60_000) // after boot, not during it
  probeTimer = setInterval(run, PROBE_INTERVAL_MS)
}

export function shutdownStuckTurnProbe(): void {
  if (warmupTimer) clearTimeout(warmupTimer)
  if (probeTimer) clearInterval(probeTimer)
}
