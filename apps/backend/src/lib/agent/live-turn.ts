// The turn a conversation is still running, read from the same SSE frames a
// reopened Desktop tab replays (this replica's run buffer, else the Redis
// mirror), so another agent reading the transcript sees it too.
import { agentRuns } from './run-admission'
import { getActiveAgentRunForSession, readAgentRunFrames } from './run-store'

type LivePart =
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; name: string; input?: unknown; output?: unknown }

export type LiveTurn = {
  startedAt: string | null
  updatedAt: string | null
  parts: LivePart[]
}

// The line is clipped to its last few thousand characters, so the newest
// frames are all a reader needs; a long turn's mirror holds tens of thousands.
const FRAME_WINDOW = 2_000

// Any of these means the turn's final message is persisted or about to be,
// so the transcript itself is the answer and a live entry would duplicate it.
const SETTLED_FRAME_TYPES = new Set([
  'atlas-transcript-tail',
  'atlas-turn-complete',
  'atlas-turn-paused',
  'atlas-stream-done',
])

// Run times are epoch milliseconds, as numbers here or strings in Redis.
function toIso(ms: number | string | null | undefined): string | null {
  const value = Number(ms ?? Number.NaN)

  return Number.isFinite(value) ? new Date(value).toISOString() : null
}

type FrameEvent = { type: string } & Record<string, unknown>

function frameEvent(frame: string): FrameEvent | null {
  if (!frame.startsWith('data: ')) return null
  try {
    const event = JSON.parse(frame.slice('data: '.length).trimEnd()) as Record<string, unknown>

    return typeof event.type === 'string' ? (event as FrameEvent) : null
  } catch {
    return null
  }
}

function applyFrameEvent(parts: LivePart[], event: FrameEvent) {
  const last = parts.at(-1)
  const tool =
    typeof event.toolCallId === 'string'
      ? parts.find((part) => part.type === 'tool' && part.id === event.toolCallId)
      : undefined

  if (event.type === 'text-start') parts.push({ type: 'text', text: '' })
  else if (event.type === 'text-delta' && typeof event.delta === 'string') {
    if (last?.type === 'text') last.text += event.delta
    else parts.push({ type: 'text', text: event.delta })
  } else if (tool?.type === 'tool') {
    if (event.type === 'tool-input-available') tool.input = event.input
    else if (event.type === 'tool-output-available') tool.output = event.output
    else if (event.type === 'tool-output-error') tool.output = event.errorText
  } else if (event.type === 'tool-input-available' && typeof event.toolCallId === 'string') {
    parts.push({
      type: 'tool',
      id: event.toolCallId,
      name: typeof event.toolName === 'string' ? event.toolName : 'tool',
      input: event.input,
    })
  }
}

/** Folds frames into ordered text and tool parts; null once the turn settled. */
export function liveTurnParts(frames: string[]): LivePart[] | null {
  const parts: LivePart[] = []

  for (const frame of frames) {
    const event = frameEvent(frame)

    if (!event) continue
    if (SETTLED_FRAME_TYPES.has(event.type)) return null
    applyFrameEvent(parts, event)
  }

  return parts
}

/** The newest frames of the session's running run, from this replica or the Redis mirror. */
async function runningFrames(
  ownerUserId: string,
  sessionId: string,
): Promise<{
  frames: string[]
  startedAt: number | string | null
  updatedAt: number | string | null
} | null> {
  let local = null

  for (const run of agentRuns.values()) {
    if (run.userId !== ownerUserId || run.sessionId !== sessionId || run.done) continue
    if (!local || run.createdAt > local.createdAt) local = run
  }
  if (local)
    return {
      frames: local.frames.slice(-FRAME_WINDOW),
      startedAt: local.createdAt,
      updatedAt: local.lastFrameAt,
    }
  const active = await getActiveAgentRunForSession(ownerUserId, sessionId)

  if (!active) return null
  const mirrored = await readAgentRunFrames(ownerUserId, active.streamId, FRAME_WINDOW)

  return {
    frames: mirrored?.frames ?? [],
    startedAt: active.startedAt,
    updatedAt: mirrored?.lastFrameAt ?? null,
  }
}

/** The session's running turn, or null when none is running. `ownerUserId` is
 *  the conversation owner, whom runs are keyed by. */
export async function getLiveTurn(
  ownerUserId: string,
  sessionId: string,
): Promise<LiveTurn | null> {
  const run = await runningFrames(ownerUserId, sessionId)
  const parts = run ? liveTurnParts(run.frames) : null

  return run && parts
    ? { startedAt: toIso(run.startedAt), updatedAt: toIso(run.updatedAt), parts }
    : null
}

/** Frames meaning the turn already said or did something, or took in another message. */
export function framesShowOutput(frames: string[]): boolean {
  return frames.some((frame) => {
    const event = frameEvent(frame)
    const delta = typeof event?.delta === 'string' ? event.delta.trim() : ''

    if (!event) return false
    if (event.type === 'text-delta' || event.type === 'reasoning-delta') return Boolean(delta)

    return event.type.startsWith('tool-') || event.type === 'data-steering'
  })
}

/** Whether the session's running turn has produced any output so far. */
export async function liveTurnHasOutput(ownerUserId: string, sessionId: string): Promise<boolean> {
  const run = await runningFrames(ownerUserId, sessionId)

  return run ? framesShowOutput(run.frames) : false
}
