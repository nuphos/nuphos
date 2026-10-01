// Token accounting for the model calls that are NOT the turn loop.
//
// Every judge, reranker, distiller and suggestion generator hits the same
// Vertex/Bedrock Claude the chat turn does, on the same SKUs, and is billed the
// same way — but only the turn loop, the title generator and the compactor ever
// wrote an agent_token_usage row. Reconciling 2026-07-31..08-07 against the GCP
// billing export left ~$55.58 that Mongo simply had no record of, which is what
// this module closes.
//
// Two rules the call sites must not get wrong, both pinned by tests:
//   - one record set per SUCCESSFUL model call, keyed by a caller-generated
//     callId, so a retried WRITE is idempotent while two genuine calls stay two
//     charges;
//   - every call site AWAITS the write (see recordSideCallTokenUsage);
//   - a call whose usage the provider never reported writes NOTHING. There is
//     no honest way to reconstruct the tokens of a request that failed before
//     the provider answered, and inventing them would corrupt the very
//     reconciliation this exists for.
import { randomUUID } from 'node:crypto'

import { logError } from '@/lib/observability'

import { makeTokenUsageRecordsForModelCall, recordAgentTokenUsageRecords } from './token-usage'
import { regionLabel, tokenUsageProvider, vertexBillingProject } from './model-provider'

import type { AgentTokenUsageRecord } from './token-usage'

export type SideCallUsageContext = {
  sessionId?: string
  userId?: string
  /** null is what the memory/attribution layers use for "personal, no team". */
  teamId?: string | null
}

/** A fresh id for one model call. Generate it ONCE per call, before the write,
 *  and reuse it if the write is retried. */
export function newModelCallId(): string {
  return randomUUID()
}

export type SideCallUsageArgs = {
  operation: string
  callId: string
  modelId: string
  context: SideCallUsageContext
  usage: unknown
  /** Attribution for jobs that are scheduled per TEAM and have no human user
   *  (cost insights). Their tokens are still the team's spend, so they bill
   *  under an explicit, obviously-synthetic id instead of being dropped. */
  systemUserId?: string
}

export function makeSideCallTokenUsageRecords(args: SideCallUsageArgs): AgentTokenUsageRecord[] {
  const userId = args.context.userId ?? args.systemUserId

  if (!userId) return []
  // Team-scoped side calls (starter suggestions) have no conversation to hang
  // off. They are still real spend, so they get a stable synthetic session id
  // rather than being dropped — it groups them in the usage views and matches
  // no conversation document, so the summary refresh is a harmless no-op.
  const sessionId = args.context.sessionId ?? `${args.operation}:${userId}`

  return makeTokenUsageRecordsForModelCall({
    recordPrefix: `${sessionId}:${args.operation}:${args.callId}`,
    sessionId,
    userId,
    teamId: args.context.teamId ?? undefined,
    operation: args.operation,
    source: 'ai-sdk',
    provider: tokenUsageProvider(),
    modelId: args.modelId,
    region: regionLabel(),
    gcpProject: vertexBillingProject(),
    stepIndex: 0,
    stepNumber: 1,
    usage: args.usage,
  })
}

/** MUST be awaited at every call site.
 *
 *  It is safe to await precisely because this function is total: it swallows
 *  and logs its own failures, so awaiting can never push a fail-open judge into
 *  its failure branch or fail the feature that spent the tokens. What awaiting
 *  DOES buy is the guarantee the accounting actually happens — a detached
 *  promise loses the write whenever the process shuts down or the request tears
 *  down first, which silently reopens the Mongo-vs-BigQuery gap this module
 *  exists to close, and does so worst exactly when traffic is being drained. */
export async function recordSideCallTokenUsage(args: SideCallUsageArgs): Promise<void> {
  try {
    await recordAgentTokenUsageRecords(makeSideCallTokenUsageRecords(args))
  } catch (err) {
    logError('agent.side_call.token_usage_persist.error', err, {
      operation: args.operation,
      model_id: args.modelId,
      session_id: args.context.sessionId,
      user_id: args.context.userId,
    })
  }
}
