// Shared narrative rendering for audit journal events — used by the in-chat
// journal side panel and the standalone Audit log page. Pure display;
// helpers live in src/lib/journalEvent.ts.

import clsx from 'clsx'
import { TriangleAlert } from 'lucide-react'

import {
  journalContentText,
  parseIntentInput,
  parseToolOutputPreview,
} from '../../lib/journalEvent'

import {
  AuthorizationChip,
  ClampedText,
  ClientTrustChip,
  RedactionChip,
  VerifiedMark,
} from './JournalEventChips'
import {
  CommandCard,
  CredentialGrantBody,
  Disclosure,
  ReasoningBlock,
  ReasoningText,
  ToolOutputBody,
} from './JournalEventDetail'
import { toolNameOf, toolResultFailed } from './journalEventTool'

import type { AgentJournalEvent } from '../../api'

export {
  AuthorizationChip,
  ClampedText,
  ClientTrustChip,
  CommandCard,
  CredentialGrantBody,
  RedactionChip,
  ReasoningBlock,
  ReasoningText,
  ToolOutputBody,
  VerifiedMark,
}
export { JournalIntegrityBadge } from './JournalEventChips'

/**
 * One row per tool call: intent + result paired by toolCallId.
 * The journal-only signal here is the MISSING result — a recorded intent with
 * no outcome means the call was rejected, interrupted, or died mid-flight,
 * which the transcript often doesn't show at all.
 */
export function PairedToolBody({
  intent,
  result,
  mayBeRunning,
  tailTruncated = false,
  reasoning,
}: {
  intent: AgentJournalEvent | null
  result: AgentJournalEvent | null
  mayBeRunning: boolean
  /** Page cut off before this call's result — a missing result proves nothing. */
  tailTruncated?: boolean
  /** The reasoning the model produced right before this call. */
  reasoning?: string
}) {
  const intentPayload = (intent?.payload ?? {}) as Record<string, unknown>
  const resultPayload = (result?.payload ?? {}) as Record<string, unknown>
  const parsed = intent ? parseIntentInput(intentPayload) : null
  const toolName = toolNameOf(intentPayload, toolNameOf(resultPayload, 'tool'))
  const isClientReported = result?.type === 'client_tool_result'
  const serverResult = result?.type === 'tool_call_result' ? resultPayload : null
  const ms =
    serverResult && typeof serverResult.durationMs === 'number'
      ? `${String(Math.round(serverResult.durationMs))}ms`
      : null
  const output = serverResult ? parseToolOutputPreview(serverResult) : null
  const failed = serverResult ? toolResultFailed(serverResult, output?.exitCode ?? null) : null
  const detail = parsed ? (parsed.command ?? parsed.rest) : ''
  // An orphan client result never had an intent — "X call" would send an
  // auditor hunting for a phantom intent event.
  const title =
    parsed?.label ??
    (isClientReported && !intent ? `${toolName} result reported by desktop` : `${toolName} call`)

  return (
    <>
      <div className="flex items-center gap-1.5 text-[12px] leading-5">
        <span className="min-w-0 truncate text-main/95">{title}</span>
        <AuthorizationChip
          authorization={intentPayload.authorization ?? resultPayload.authorization}
        />
        <RedactionChip count={intentPayload.redactionCount} />
        {isClientReported && <ClientTrustChip />}
        {serverResult &&
          (failed ? (
            <span className="flex-shrink-0 text-[10px] font-medium text-error">
              failed
              {output?.exitCode !== null && output?.exitCode !== 0
                ? ` · exit ${String(output?.exitCode)}`
                : ''}
              {ms ? ` · ${ms}` : ''}
            </span>
          ) : (
            <span className="flex-shrink-0 text-[10px] text-tertiary">{ms ?? 'ok'}</span>
          ))}
        {!result && mayBeRunning && (
          <span className="flex-shrink-0 text-[10px] text-tertiary">running…</span>
        )}
        {!result && !mayBeRunning && tailTruncated && (
          <span
            className="flex-shrink-0 text-[10px] text-tertiary"
            title="The journal page is truncated — this call's result may exist beyond the loaded events"
          >
            result not in loaded events
          </span>
        )}
      </div>
      {!result && !mayBeRunning && !tailTruncated && (
        <div
          className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400/90"
          title="A tool_call_intent was durably journaled but no result event followed — the call was rejected, interrupted, or crashed"
        >
          <TriangleAlert className="h-2.5 w-2.5" strokeWidth={2} />
          no result recorded — rejected or interrupted
        </div>
      )}
      {reasoning ? <ReasoningText text={reasoning} label="Reasoning before this call" /> : null}
      {detail && (
        <Disclosure summary="command">
          <CommandCard
            command={parsed?.command ?? null}
            rest={parsed?.command ? parsed.rest : detail}
          />
        </Disclosure>
      )}
      {serverResult && output?.raw ? (
        <Disclosure summary="output">
          <ToolOutputBody payload={serverResult} />
        </Disclosure>
      ) : null}
    </>
  )
}

/**
 * One narrative block per event: a scannable title line; command/output detail
 * folded by default (the timeline exists to scan and attest — full content is
 * one click away, or in the conversation via the anchor).
 */
export function JournalEventBody({
  event,
  reasoningOverride,
}: {
  event: AgentJournalEvent
  /** Timeline passes the assistant's TRAILING reasoning only (the
   *  per-tool reasoning is shown on the tool rows). Undefined = show all
   *  reasoning from contentHot (the flat audit-events view). */
  reasoningOverride?: string
}) {
  const payload = (event.payload ?? {}) as Record<string, unknown>

  switch (event.type) {
    case 'tool_call_intent': {
      const intent = parseIntentInput(payload)
      const detail = intent.command ?? intent.rest

      return (
        <>
          <div className="flex items-center gap-1.5 text-[12px] leading-5 text-main/95">
            <span className="min-w-0 truncate">
              {intent.label ?? `${toolNameOf(payload, 'tool')} call`}
            </span>
            <AuthorizationChip authorization={payload.authorization} />
            <RedactionChip count={payload.redactionCount} />
          </div>
          {detail && (
            <Disclosure summary="command">
              <CommandCard command={intent.command} rest={intent.command ? intent.rest : detail} />
            </Disclosure>
          )}
        </>
      )
    }
    case 'tool_call_result': {
      const ms =
        typeof payload.durationMs === 'number'
          ? `${String(Math.round(payload.durationMs))}ms`
          : null
      const output = parseToolOutputPreview(payload)
      const failed = toolResultFailed(payload, output.exitCode)

      return (
        <>
          <div className={clsx('text-[12px] leading-5', failed ? 'text-error' : 'text-main/85')}>
            {toolNameOf(payload, 'tool')} {failed ? 'failed' : 'succeeded'}
            {output.exitCode !== null && output.exitCode !== 0
              ? ` · exit ${String(output.exitCode)}`
              : ''}
            {ms ? ` · ${ms}` : ''}
          </div>
          {output.raw && (
            <Disclosure summary="output">
              <ToolOutputBody payload={payload} />
            </Disclosure>
          )}
        </>
      )
    }
    case 'user_message':
    case 'assistant_message': {
      const text = journalContentText(event.contentHot)

      return (
        <>
          <div className="flex items-center gap-1.5 text-[12px] leading-5 text-main/95">
            {event.type === 'user_message' ? 'User' : 'Assistant'}
            <VerifiedMark verified={event.contentVerified} />
          </div>
          {text ? (
            // One-line excerpt by default: the full text lives in the chat a
            // click away (anchor); the excerpt exists to scan and to carry
            // the verified mark, not to duplicate the transcript.
            <ClampedText text={text} limit={140} />
          ) : (
            <div className="text-[11px] text-tertiary">
              content hash only{event.contentHot === undefined ? ' (recorded before v2)' : ''}
            </div>
          )}
          {event.type === 'assistant_message' &&
            (reasoningOverride !== undefined ? (
              <ReasoningText text={reasoningOverride} />
            ) : (
              <ReasoningBlock contentHot={event.contentHot} />
            ))}
        </>
      )
    }
    case 'client_tool_result':
      return (
        <div className="flex items-center gap-1.5 text-[12px] leading-5 text-main/85">
          <span className="min-w-0 truncate">
            {toolNameOf(payload, 'local tool')} result reported by desktop
          </span>
          <AuthorizationChip authorization={payload.authorization} />
          <ClientTrustChip />
        </div>
      )
    case 'credential_grant':
      return (
        <>
          <div className="text-[12px] leading-5 text-main/95">Credentials granted this turn</div>
          <CredentialGrantBody payload={payload} />
        </>
      )
    case 'user_approval': {
      const planNumber = payload.planNumber
      const rejected = payload.decision === 'rejected'
      const label =
        typeof planNumber === 'number'
          ? `Plan #${String(planNumber)} ${rejected ? 'rejected' : 'approved'}`
          : 'User approval recorded'

      return (
        <div className={clsx('text-[12px] leading-5', rejected ? 'text-error/90' : 'text-main/95')}>
          {label}
        </div>
      )
    }
    case 'turn_end':
      return <div className="text-[11.5px] leading-5 text-tertiary">Turn finished</div>
    case 'conversation_retention_tombstone':
    case 'journal_retention_expired':
      return <div className="text-[12px] leading-5 text-tertiary">Retention tombstone</div>
    default:
      return <div className="text-[12px] leading-5 text-main/85">{event.type}</div>
  }
}
