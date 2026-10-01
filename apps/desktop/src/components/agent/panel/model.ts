import { FIRST_RUN_CONVO_EVENT } from '../../../lib/firstRunConnect'

import { AGENT_PHASE_LABELS } from './agentPhase'

import type { AgentPhase } from './agentPhase'
import type { Part } from './parts'
import type { AgentConversation, AgentCredentialSelection, AgentSlackThread } from '../../../api'
import type { FirstRunConvoPhase } from '../../../lib/firstRunConnect'

export type MessageRating = 'up' | 'down'

export type Message = {
  metadata?: import('../../../api/agent-types').AgentMessageMetadata
  id: string
  role: 'user' | 'assistant'
  parts: Part[]
  /** The attached runtime resumed this session without a new user message. */
  turnOrigin?: 'autonomous'
  /** A user turn the app generated for a plan approval, not typed text. */
  turnKind?: 'plan-approval'
  stoppedByUser?: boolean
  /** First-persisted time (ms): turn start for user messages, turn end for
   *  assistant messages. Live messages are stamped client-side at the same
   *  boundaries so the hover timestamp renders without a reload. */
  createdAt?: number
  /** Viewer's stored thumbs reaction (assistant messages only). */
  feedback?: MessageRating
}

export type AgentPromptSeed = {
  text: string
  nonce: number
  filePaths?: string[]
  autoSend?: boolean
  newChat?: boolean
  mode?: 'mention' | 'text'
  // Clear the composer before inserting — prefill shortcuts replace any
  // existing draft instead of stacking onto it on repeated clicks.
  replace?: boolean
}

export { AGENT_PHASE_LABELS }
export type { AgentPhase }

export type AgentStatus = {
  label: string
  startedAt: number | null
}

export const TOOL_DESCRIPTION_KEYS = [
  'label',
  'title',
  'description',
  'name',
  'query',
  'url',
  'path',
  'filePath',
  'command',
] as const

export function compactToolDescription(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()

  if (normalized.length <= 96) return normalized

  return `${normalized.slice(0, 95)}…`
}

export function getToolInputDescription(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>

  for (const key of TOOL_DESCRIPTION_KEYS) {
    const value = record[key]

    if (typeof value === 'string' && value.trim()) return compactToolDescription(value)
  }

  return null
}

export type AgentSetupRequiredInfo = {
  message: string
  reason?: 'reauthentication'
}

export type Tab = {
  runtimeState?: import('../../../lib/runtimeExecution').RuntimeExecution
  id: string
  sessionId: string
  title: string
  messages: Message[]
  streaming: boolean
  connected: boolean
  phase?: AgentPhase | null
  /** Server timestamp for the current phase; survives buffered stream replay. */
  phaseStartedAt?: number | null
  streamId: string | null
  // Set when this tab adopted a run another client started (another device of
  // the same user, a trigger, a Slack turn) to follow along. Compared against
  // the ending stream, so a stale value can never match a stream this client
  // started itself — see clientToolsBelongToThisClient.
  attachedStreamId?: string | null
  streamStartedAt: number | null
  error: string | null
  // Claude Code/OpenAB is the sole runtime, but this workspace has no OAuth
  // token yet. Rendered as setup guidance instead of a transport failure.
  agentSetupRequired?: AgentSetupRequiredInfo | null
  // Mid-task resubmit (client-tool run / approval resume): suppress the boot
  // ceremony (Connecting… / phase labels) — show one steady label instead.
  bootQuiet?: boolean
  // Consecutive continuation attempts that have produced NO new assistant
  // output. Reset to 0 whenever a stream delivers a renderable frame (real
  // progress proves the backend isn't deterministically broken), when the
  // user sends a new message, or when a turn ends cleanly. Capped at
  // MAX_AUTO_RESUME_ATTEMPTS to stop transport-level retry loops.
  autoResumeAttempts: number
  credentialAccess: AgentCredentialSelection
  // Absolute transcript index of messages[0]. > 0 when the conversation was
  // opened with a paginated tail and earlier messages exist server-side; every
  // send/sync forwards it as `baseIndex` so the backend hydrates the stored
  // prefix. 0 / undefined = messages is the full transcript. Scroll-up paging
  // walks it down to 0.
  historyBaseIndex?: number
  // An earlier-messages page fetch is in flight (top-of-transcript spinner).
  loadingEarlier?: boolean
  readOnly?: boolean
  // readOnly was forced by an audit open (the backend said writable) — an
  // interactive reopen clears it. Never set when readOnly came from the
  // backend (foreign/Slack conversations), so those can't be un-locked.
  auditForcedReadOnly?: boolean
  /** A teammate's conversation: owner-only endpoints answer 403, so never call them. */
  foreign?: boolean
  /** Every credential option that existed when this conversation's selection was last saved. */
  credentialOptionsSeen?: AgentCredentialSelection
  slackThread?: AgentSlackThread | null
  activitySource?: AgentConversation['activitySource']
  /** Poll for runtime-owned turns (for example ScheduleWakeup) while this tab is visible. */
  claudeCodeRuntimeAttached?: boolean
  agentRuntime?: 'claude-code' | 'codex'
  runtimeId?: string
  runtimeLabel?: string
  // Follow-up messages the user submitted while this tab was still streaming.
  // They are dispatched one at a time, in order, once the current turn ends
  // cleanly (no error). Optional so older persisted snapshots keep loading;
  // read with `?? []`.
  queued?: QueuedMessage[]
  // Deterministic-failure detector: the last normalized error that latched and
  // how many times in a row it did. Deliberately NOT cleared when a new turn
  // dispatches (a retry into the same broken transcript must escalate, not
  // reset — session 3c2e03db failed identically 5× in 16s with no hint that
  // retrying was pointless). Reset only when a stream delivers renderable
  // progress. Optional so persisted snapshots from older builds keep loading.
  lastErrorKey?: string | null
  errorStreak?: number
}

// A user message parked in a tab's queue while the agent is mid-turn.
export type QueuedMessage = {
  id: string
  text: string
  filePaths: string[]
  steering?: boolean
  turnKind?: Message['turnKind']
  /** Sends itself as soon as the agent reports it can accept a message. */
  autoSend?: boolean
}

export type { Tab as AgentSessionSnapshot }

export const HOME_TAB_ID = '__home__'

// The first-run guide advances its journey strip on real conversation moves
// (question sent, answer landed), but it lives in a different component tree;
// these breadcrumbs cross the gap as window events. Fired unconditionally and
// fire-and-forget — with no guide listening they are inert.
export function emitFirstRunConvo(phase: FirstRunConvoPhase) {
  window.dispatchEvent(
    new CustomEvent<{ phase: FirstRunConvoPhase }>(FIRST_RUN_CONVO_EVENT, { detail: { phase } }),
  )
}

export const AUTO_SCROLL_BOTTOM_THRESHOLD = 48
// Opening a conversation fetches only this many trailing messages; earlier
// pages stream in as the user scrolls up (see loadEarlierMessages). Long
// sessions used to ship the entire multi-MB transcript before first paint.
export const CONVERSATION_TAIL_LIMIT = 100
export const EARLIER_MESSAGES_PAGE_SIZE = 100
// Distance from the top of the transcript (px) at which the next earlier page
// starts loading.
export const EARLIER_MESSAGES_SCROLL_THRESHOLD = 300
// Backend emits this SSE frame right before atlas-stream-done when, and only
// when, the AI SDK's streamText finished with finishReason === 'stop' (Bedrock
// end_turn).
export const AGENT_TURN_COMPLETE_EVENT = 'atlas-turn-complete'
// Backend emits this when the turn ended on a non-`stop` finishReason
// (output-budget, content filter, stall watchdog). It carries the reason, and
// for everything except a recoverable stall the reason is all the renderer
// does with it: a turn the backend says it stopped is over, and the user is
// told which of its own limits it hit rather than watching a spinner that
// implies work is still happening.
export const AGENT_TURN_PAUSED_EVENT = 'atlas-turn-paused'
// First frame of a user turn; carries the input messages that started it.
export const AGENT_TURN_START_EVENT = 'atlas-turn-start'
// Cap on CONSECUTIVE no-progress resumes. It covers streams that ended with no
// terminal frame at all, plus the recoverable stall pauses below; any
// renderable frame resets the counter. 10 rides out
// multi-minute infra blips (rolling deploys, all replicas restarting);
// deterministic failures still die fast because HTTP errors and SSE error
// frames latch tab.error and skip auto-resume entirely.
export const MAX_AUTO_RESUME_ATTEMPTS = 10
// Pause reasons a second attempt can clear. The backend's stall watchdogs fire
// when the model or a tool goes quiet — a wedge the next request usually shakes
// loose — so treating them as terminal would turn a transient hiccup into a
// user-facing failure. Every other reason it names (the output cap, a content
// filter) reproduces on replay and ends the turn.
//
// A recovered pause still gets no "Continuing…" label: a resume is an attempt,
// not a promise. It rides the same transport budget above, so a backend that
// stalls every round surfaces instead of looping.
export const RECOVERABLE_PAUSE_REASONS = new Set(['model-silence', 'tool-execution-timeout'])
