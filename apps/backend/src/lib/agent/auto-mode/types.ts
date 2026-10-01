// Auto Mode: per-command authorization for the agent's bash (sandbox) and
// local_exec (local) tools. Shared types.
//
// Design: a layered gate that decides, before every command runs, whether it
// needs the user's authorization.
//   Layer 1  read-only fast-path  → auto-allow (deterministic, no LLM)
//   Layer 2  catastrophic floor   → always require auth (deterministic, cannot
//                                    be overridden by policy or the judge)
//   Layer 3  LLM judge vs policy  → decides the nuanced middle, fail-safe
// Every decision is journaled. read defaults to allow, write defaults to
// require-auth; the user grows a natural-language policy to auto-allow more.

export type AuthDecision = 'allow' | 'require_auth'

export type AuthLayer =
  | 'disabled' // auto mode off → allow everything (legacy behaviour)
  | 'bypass' // user turned on Bypass Permissions for this conversation
  | 'read_only_fastpath' // layer 1: deterministically read-only
  | 'session_grant' // a prior approval / policy rule already covers this
  | 'llm_judge' // layer 3: model verdict against policy
  | 'judge_unavailable' // judge failed → fail-safe require_auth
  | 'default_write' // no judge configured → non-read-only requires auth

/** Which policy element authorized an auto-allow — surfaced on every
 *  auto-authorized tool call so the user can see WHY it ran without asking. */
export type TriggeringPolicy =
  | { kind: 'read_only' }
  | { kind: 'bypass' }
  | { kind: 'prior_grant' }
  | { kind: 'rule'; ruleId?: string; description: string }
  // The judge decided it was a safe read/no-op — no standing rule matched.
  | { kind: 'judge'; reason: string }

export type AuthVerdict = {
  decision: AuthDecision
  layer: AuthLayer
  /** One-line human-readable justification (goes to the model + the journal). */
  reason: string
  /** Coarse operation class the judge/analysis assigned. */
  operation?: 'read' | 'write' | 'unknown'
  /** For require_auth: a short, generalized description of the operation the
   *  user can turn into a standing allow-rule (e.g. "restart a staging
   *  deployment"). */
  suggestedRule?: string
  /** For allow: which policy element triggered the auto-authorization. */
  triggeredBy?: TriggeringPolicy
}

/** A standing rule that auto-allows a class of operations. Personal (per-user).
 *  `proposed` rules (staged by the agent) do NOT auto-allow until the user
 *  activates them in the settings list; `active` rules are live. */
export type AutoModeRule = {
  id: string
  /** Natural-language description the judge matches against, e.g.
   *  "restarting deployments in the staging namespace". */
  description: string
  status: 'proposed' | 'active'
  createdBy: string
  createdAt: Date
  /** Set when the agent proposed it, for the GUI ("proposed while working on…"). */
  proposedFromConversationId?: string
}

/** A user's effective Auto Mode policy (only ACTIVE rules reach the judge). */
export type AutoModePolicy = {
  /** Active standing natural-language allow-rules. */
  rules: AutoModeRule[]
  /** Exact command strings the user approved "always". */
  approvedCommands: string[]
}

export const EMPTY_POLICY: AutoModePolicy = { rules: [], approvedCommands: [] }
