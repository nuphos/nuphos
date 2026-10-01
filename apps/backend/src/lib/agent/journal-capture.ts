// Agent-side capture glue for the tamper-evident audit journal (commit ② of
// the design). The pure chain/hash/redaction logic lives in @/lib/journal —
// this module owns:
//   - the per-turn AgentJournal context (identity + session in one place)
//   - tool interception via wrapToolsWithJournal (the tools record returned by
//     createSkilledTools is the single choke point for every server-executed
//     tool, bash included)
//   - fail-closed vs fail-open semantics per tool
//   - transcript/user-message/client-tool capture helpers for the /chat route
//
// Fail-closed contract (v2 design): for mutating tools the tool_call_intent
// event must be durably appended BEFORE the tool runs; if the journal write
// fails the tool must not run. There is deliberately no kill-switch — a
// disable flag would itself be a tamper vector.

export {
  extractClientToolResults,
  MUTATING_TOOL_NAMES,
  summarizeCredentialAccess,
} from './journal-capture/helpers'
export { AgentJournal } from './journal-capture/journal'
export { journalPlanDecision, wrapToolsWithJournal } from './journal-capture/wrap'

export type { TranscriptMessageLike } from './journal-capture/helpers'
export type { AgentJournalInit, ToolAuthorization } from './journal-capture/types'
