import type { AgentCredentialSelection } from './agent-types.ts'
import type { SessionConfigPick } from './session-config-types.ts'
import type { AgentProvider } from '../types/runtime.ts'

export type AgentStartArgs = {
  decisionReplyTo?: string
  streamId: string
  sessionId: string
  teamId?: string
  messages: unknown[]
  baseIndex?: number
  locale?: string
  url?: string
  kubeContext?: string
  diagramId?: string
  resume?: boolean
  resumeFrom?: number
  continueAfterInterruption?: boolean
  resumeReason?: 'permission-decision' | 'approval-decision' | 'client-tool'
  credentialAccess?: AgentCredentialSelection
  /** Authorization mode for a conversation being created by this call. */
  permissionMode?: 'auto' | 'bypass'
  agentRuntime?: AgentProvider
  runtimeId?: string
  /** Model settings picked before this conversation existed. */
  initialSessionConfig?: SessionConfigPick
  /** The project folder a new task works in. */
  workspace?: { kind: 'folder'; path: string }
}

export type AgentDecisionApi = {
  agentResolveDecision(
    sessionId: string,
    toolCallId: string,
    teamId?: string,
    resolution?: 'answered' | 'dismissed',
  ): Promise<{ ok: boolean; resolved: boolean }>
  agentAnswerDecision(
    sessionId: string,
    requestId: string,
    teamId: string | undefined,
    answer: DecisionAnswer,
  ): Promise<{ ok: boolean }>
}

/** A person's answer to a question: picked options, typed text, or one per question. */
export type DecisionAnswer = {
  choices?: string[]
  text?: string
  questions?: { choices?: string[]; text?: string }[]
}
