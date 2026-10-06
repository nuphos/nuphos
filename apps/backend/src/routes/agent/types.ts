import type { AgentCredentialSelection } from './types-credentials'
import type { SpanLike } from '@/lib/agent/braintrust'
import type { AgentSessionOrigin } from '@/lib/agent/tools-triggers-shared'
import type { OpenAbProvider } from '@/lib/claude-code-preview/runtime-provider'
import type { SlackTriggerNotificationContext } from '@/lib/slack/incident-notifications'
import type { UIMessage } from 'ai'

export type AgentChatBody = {
  id: string
  teamId?: string
  messages: UIMessage[]
  /** Absolute transcript index of messages[0]. When > 0 the client holds only
   *  a tail of the transcript (paginated open) and the server prepends the
   *  stored prefix [0, baseIndex) before the request is processed. Omitted or
   *  0 = messages is the full transcript (legacy behaviour). */
  baseIndex?: number
  streamId?: string
  resume?: boolean
  resumeFrom?: number
  // Set by the client when the previous turn ended without a turn-complete
  // signal — injects a system message asking the model to pick up from the
  // partial state in the transcript rather than treating the request as a new
  // user turn.
  continueAfterInterruption?: boolean
  /** Why the turn is being continued. 'permission-decision' = an admin just
   *  approved/rejected an inline permission proposal; the continuation nudge is
   *  reframed so the model reads the tool result as authoritative instead of
   *  treating the clean pause as an interruption to re-verify. */
  resumeReason?: 'permission-decision' | 'approval-decision' | 'client-tool'
  credentialAccess?: AgentCredentialSelection
  /** The authorization mode the client started this conversation in. Honoured
   *  only on the first turn, including a row created by transcript sync. */
  permissionMode?: 'auto' | 'bypass'
  agentRuntime?: OpenAbProvider
  runtimeId?: string
  clientCapabilities?: {
    localTools?: boolean
  }
}

export type { AgentCredentialSelection, AgentCredentialOptions } from './types-credentials'

export type InternalChatCtx = {
  requestId: string
  streamId: string
  // The actor whose permissions, credentials, memory and audit identity apply
  // to this turn.
  userId: string
  // Shared external threads keep a single durable conversation owned by the
  // user who created it. Omitted for ordinary single-user turns.
  conversationOwnerUserId?: string
  nuphosToken: string
  locale: string
  currentUrl: string | null
  localToolsEnabled: boolean
  // Kubeconfig context the desktop's current workspace tab is bound to (sent
  // via X-Atlas-Kube-Context). Plumbed into the system prompt so the agent
  // knows which `context` to pass to typed K8s tools like port_forward_start
  // — without it the agent has to guess or call kubectl config get-contexts.
  kubeContext: string | undefined
  // Architecture diagram the desktop's current tab has open (X-Atlas-Diagram-Id).
  // When present, the agent gets the arch_* editing tools scoped to this diagram.
  diagramId: string | undefined
  // Whether this turn originated from an interactive in-app session (the Nuphos
  // web/desktop UI) vs. an automated trigger or external channel (cron, Slack,
  // Discord). The plan-gating rubric keys on this instead of having the model
  // infer the origin — external turns must never emit a plan card.
  isInApp: boolean
  // Session origin for the trigger tools' self-replication guard: sessions
  // fired BY a trigger must not create new triggers. Interactive channels are 'user'.
  agentOrigin: AgentSessionOrigin
  // Present only for monitoring-trigger runs. This server-owned context lets
  // slack_post coordinate one incident across otherwise separate deliveries.
  triggerNotification?: SlackTriggerNotificationContext
  // Names the chat client this turn is read in ("a Slack thread", "a Lark
  // chat"). Stated to the model rather than left for it to infer from the
  // rendered message, for the same reason isInApp exists: an inference buried
  // in the user's text loses to the explicit instructions around it.
  chatSurface?: string
}

export type AgentRunSubscriber = {
  poke: () => void
}

export type AgentRun = {
  key: string
  streamId: string
  sessionId: string
  userId: string
  trace?: AgentRunTrace
  frames: string[]
  done: boolean
  // Latest finishReason observed from streamText's onFinish. Stays undefined
  // when the run aborts/errors before onFinish fires, which is exactly the
  // signal pumpAgentResponseToRun uses to suppress the turn-complete frame.
  lastFinishReason?: string
  /** The turn ended because a command needs the user's authorization. The pump
   *  emits a clean turn-complete (NOT turn-paused) so the desktop does NOT
   *  auto-resume — it must wait for the user's approve/deny. */
  awaitingAuthorization?: boolean
  /** The runtime parked this turn on a blocking decision of this kind. */
  awaitingDecision?: string
  approvalPushed?: boolean
  activityRecorded?: Promise<void>
  abortController: AbortController
  subscribers: Set<AgentRunSubscriber>
  createdAt: number
  lastAccessAt: number
  /** When this run last APPENDED a frame. Distinct from `lastAccessAt`, which a
   *  reader attaching to the stream also refreshes: a client resuming a dead
   *  run every few seconds keeps that one warm forever, which is precisely the
   *  case the stall sweeper has to catch. */
  lastFrameAt: number
  /** Latest prep phase and when it started, so each transition can be timed. */
  currentPhase?: string
  phaseStartedAt?: number
  /** Absolute wall-clock deadline for headless turns; undefined in-app, where
   *  the user can stop the turn themselves. */
  deadlineAt?: number
  cleanupTimer?: ReturnType<typeof setTimeout>
  /** Releases the Redis ownership lease + stops the heartbeat. No-op when
   *  Redis is disabled. */
  releaseOwnership: () => void
}

export type AgentRunTrace = {
  requestId: string
  userId: string
  sessionId: string
  teamId?: string
  streamId: string
  route: string
  method: string
  chatSpan?: SpanLike
  streamSpan?: SpanLike
}

export type ResumeParams = {
  requestId: string
  userId: string
  runOwnerUserId: string
  sessionId: string
  teamId: string | undefined
  streamId: string
  body: AgentChatBody
  readOnlyResume: boolean
}
