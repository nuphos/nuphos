import { JournalWriter, deriveEventId } from '@/lib/journal'
import { logError } from '@/lib/observability'

import { findActivePlanForConversation } from '../plans'

import {
  captureClientToolResults,
  captureToolIntent,
  captureToolResult,
  captureTranscriptMessages,
} from './events'
import { getJournalCollection, summarizeCredentialAccess } from './helpers'

import type { JournalContext } from './events'
import type { TranscriptMessageLike } from './helpers'
import type { AgentJournalInit, ToolAuthorization } from './types'
import type { AuditEventType, JournalDoc, JsonValue } from '@/lib/journal'
import type { Collection } from 'mongodb'

export class AgentJournal {
  private readonly actor: { userId: string; teamId: string | null }
  private readonly base: {
    conversationId: string
    requestId: string
    streamId: string
    modelId: string
  }
  private writerInstance: JournalWriter | null
  private collectionInstance: Collection<JournalDoc> | null
  private readonly resolveActivePlan: (
    sessionId: string,
    scope: { teamId: string | null; userId: string },
  ) => Promise<{ planNumber: number; approvedBy?: string } | null>
  private authorizationPromise: Promise<ToolAuthorization | null> | null = null

  constructor(init: AgentJournalInit) {
    this.actor = { userId: init.userId, teamId: init.teamId }
    this.base = {
      conversationId: init.conversationId,
      requestId: init.requestId,
      streamId: init.streamId,
      modelId: init.modelId,
    }
    this.writerInstance = init.writer ?? null
    this.collectionInstance = init.collection ?? null
    this.resolveActivePlan = init.resolveActivePlan ?? findActivePlanForConversation
  }

  /**
   * Execution authorization for this run's tool calls: a whole turn either
   * executes an approved/executing plan or is agent-initiated (the user's
   * implicit authorization is the conversation itself). Resolved once per run;
   * a lookup failure yields null and the payload simply omits the field — never
   * a guessed attribution.
   */
  private authorization(): Promise<ToolAuthorization | null> {
    if (!this.authorizationPromise) {
      this.authorizationPromise = this.resolveActivePlan(this.base.conversationId, this.actor)
        .then((plan): ToolAuthorization =>
          plan
            ? {
                kind: 'plan-approved',
                basis: 'active-plan',
                planNumber: plan.planNumber,
                ...(plan.approvedBy ? { approvedBy: plan.approvedBy } : {}),
              }
            : { kind: 'agent-initiated', basis: 'no-active-plan' },
        )
        .catch((err: unknown) => {
          logError('journal.authorization_lookup_failed', err, {
            session_id: this.base.conversationId,
          })

          return null
        })
    }

    return this.authorizationPromise
  }

  private async collection(): Promise<Collection<JournalDoc>> {
    if (!this.collectionInstance) this.collectionInstance = await getJournalCollection()

    return this.collectionInstance
  }

  private async writer(): Promise<JournalWriter> {
    if (!this.writerInstance) this.writerInstance = new JournalWriter(await this.collection())

    return this.writerInstance
  }

  private session(toolCallId: string | null = null) {
    return {
      conversationId: this.base.conversationId,
      requestId: this.base.requestId,
      streamId: this.base.streamId,
      toolCallId,
      modelId: this.base.modelId,
    }
  }

  private async append(
    type: AuditEventType,
    payload: JsonValue,
    idParts: { toolCallId?: string; messageId?: string; qualifier?: string },
    contentHot?: JsonValue,
  ) {
    const eventId = deriveEventId(type, {
      conversationId: this.base.conversationId,
      requestId: this.base.requestId,
      toolCallId: idParts.toolCallId ?? null,
      messageId: idParts.messageId ?? null,
      qualifier: idParts.qualifier ?? null,
    })
    const writer = await this.writer()

    return writer.append({
      eventId,
      type,
      actor: this.actor,
      session: this.session(idParts.toolCallId ?? null),
      payload,
      contentHot,
    })
  }

  /** Fail-open append: never throws; failures are logged for alerting. */
  private async appendOpen(
    type: AuditEventType,
    payload: JsonValue,
    idParts: { toolCallId?: string; messageId?: string; qualifier?: string } = {},
    contentHot?: JsonValue,
  ): Promise<void> {
    try {
      await this.append(type, payload, idParts, contentHot)
    } catch (err) {
      logError('journal.append_failed', err, {
        journal_event_type: type,
        session_id: this.base.conversationId,
        request_id: this.base.requestId,
        user_id: this.actor.userId,
      })
    }
  }

  private context(): JournalContext {
    return {
      actor: this.actor,
      base: this.base,
      collection: () => this.collection(),
      append: (type, payload, idParts, contentHot) =>
        this.append(type, payload, idParts, contentHot),
      appendOpen: (type, payload, idParts, contentHot) =>
        this.appendOpen(type, payload, idParts, contentHot),
      authorization: () => this.authorization(),
    }
  }

  async turnStart(meta: { messageCount: number; localToolsEnabled: boolean }): Promise<void> {
    await this.appendOpen('turn_start', {
      messageCount: meta.messageCount,
      localToolsEnabled: meta.localToolsEnabled,
    })
  }

  async turnEnd(meta: { finishReason?: string | null; messageCount?: number }): Promise<void> {
    await this.appendOpen('turn_end', {
      finishReason: meta.finishReason ?? null,
      messageCount: meta.messageCount ?? null,
    })
  }

  async credentialGrant(access: Record<string, unknown>): Promise<void> {
    await this.appendOpen('credential_grant', { access: summarizeCredentialAccess(access) })
  }

  /**
   * A plan approval/rejection — the human authorization event on the chain.
   * This is the trust root a tool intent's plan-approved attribution points
   * back at, so it belongs on the tamper-evident chain, not just the mutable
   * plans collection. The actor is whoever decided (may differ from the
   * conversation owner).
   *
   * eventId derives from (conversation, plan#, decision, decidedAt): the
   * decidedAt timestamp is re-stamped on every approval, and cleared+re-set
   * when a failed plan is retried and re-approved — so a genuinely new
   * authorization is a new chain event, while an accidental re-journal of the
   * SAME decision still dedupes.
   */
  async planDecision(input: {
    planNumber: number
    decision: 'approved' | 'rejected'
    decidedAt: string
  }): Promise<void> {
    await this.appendOpen(
      'user_approval',
      { planNumber: input.planNumber, decision: input.decision, decidedAt: input.decidedAt },
      { toolCallId: `${input.decision}:${input.decidedAt}` },
    )
  }

  /**
   * Journal content hashes for transcript messages of one role. Payloads hold
   * hashes + sizes, never content: the journal proves the hot copy in
   * agent_messages is (or is not) what the agent actually saw/produced.
   * Dedupe is by eventId, so re-syncing old messages is a no-op; the batched
   * existence pre-check keeps that no-op cheap for long conversations.
   */
  async transcriptMessages(
    messages: TranscriptMessageLike[],
    role: 'user' | 'assistant',
  ): Promise<void> {
    await captureTranscriptMessages(this.context(), messages, role)
  }

  /** Desktop-executed tool results are self-reported — journaled with an explicit low-trust marker. */
  async clientToolResults(messages: TranscriptMessageLike[]): Promise<void> {
    await captureClientToolResults(this.context(), messages)
  }

  /**
   * tool_call_intent MUST be durably recorded before a fail-closed tool runs.
   * Throws for fail-closed tools when the append fails; the thrown error
   * reaches the model as a failed tool call ("do not execute").
   */
  async toolIntent(input: { toolName: string; toolCallId: string; input: unknown }): Promise<void> {
    await captureToolIntent(this.context(), input)
  }

  async toolResult(result: {
    toolName: string
    toolCallId: string
    success: boolean
    output: unknown
    durationMs: number
  }): Promise<void> {
    await captureToolResult(this.context(), result)
  }

  /**
   * Records an Auto Mode authorization decision on the tamper-evident chain
   * (see lib/agent/auto-mode). Fail-open — a decision record must never block
   * the gate; the gate itself is what enforces. The `decision` is part of the
   * event qualifier so an require-auth-then-approved-then-run sequence lands
   * as distinct chain events rather than deduping.
   */
  async authDecision(d: {
    toolName: string
    toolCallId: string
    decision: 'allow' | 'require_auth'
    layer: string
    reason: string
    commandHash: string
  }): Promise<void> {
    await this.appendOpen(
      'auth_decision',
      {
        toolName: d.toolName,
        decision: d.decision,
        layer: d.layer,
        reason: d.reason,
        commandHash: d.commandHash,
      },
      { toolCallId: d.toolCallId, qualifier: d.decision },
    )
  }
}
