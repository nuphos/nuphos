// Auto Mode decision engine — composes the three layers into one verdict.
// Pure and import-light (types + command-analysis only) so it is fully
// unit-testable and loads without @/config. The LLM judge is injected as a
// function so this module has no Bedrock dependency.

import { analyzeCommand } from './command-analysis'
import { EMPTY_POLICY } from './types'

import type { CommandAnalysis } from './command-analysis'
import type { AuthVerdict, AutoModePolicy } from './types'

export type JudgeResult = {
  /** Does this need the user's authorization? */
  requireAuth: boolean
  operation: 'read' | 'write' | 'unknown'
  reason: string
  /** Generalized description the user could turn into a standing rule. */
  suggestedRule?: string
  /** True when a policy rule the judge was given already covers this. */
  matchedPolicyRule?: boolean
  /** 1-based index of the matched rule in the policy list, when matched. */
  matchedRuleIndex?: number
}

export type Judge = (input: {
  command: string
  analysis: CommandAnalysis
  policy: AutoModePolicy
  sessionCommands?: string[]
  sessionApprovals?: string[]
}) => Promise<JudgeResult | null> // null = judge unavailable (timeout/error/parse)

export type DecideOptions = {
  enabled: boolean
  command: string
  /** User-enabled Full Access for this conversation: allow everything
   *  without consulting policy or the judge. Journaled as its own layer. */
  bypass?: boolean
  policy?: AutoModePolicy
  /** Commands that already executed earlier in this session — judge context
   *  for resolving aliases (kube contexts, env vars), never approvals. */
  sessionCommands?: string[]
  /** Commands the user approved for this session ("Approve for session").
   *  Exact match short-circuits; the judge covers same-effect variants. */
  sessionApprovals?: string[]
  /** Injected LLM judge. When absent, non-read-only falls to default_write. */
  judge?: Judge
}

const norm = (c: string) => c.trim().replace(/\s+/g, ' ')

/**
 * Decide whether a command needs authorization. The judge is the authority;
 * the only static shortcuts are explicit grants and the read-only fast-path
 * (skips a judge call for trivially-safe reads).
 */
export async function decideAuthorization(opts: DecideOptions): Promise<AuthVerdict> {
  if (!opts.enabled) {
    return { decision: 'allow', layer: 'disabled', reason: 'Auto Mode is disabled' }
  }

  // 0. Full Access — the user explicitly disarmed the gate for this
  // conversation, so nothing below (fast-path, grants, judge) runs.
  if (opts.bypass) {
    return {
      decision: 'allow',
      layer: 'bypass',
      reason: 'Full Access is on for this conversation.',
      operation: 'unknown',
      triggeredBy: { kind: 'bypass' },
    }
  }

  const analysis = analyzeCommand(opts.command)
  const policy = opts.policy ?? EMPTY_POLICY

  // 1. Read-only fast-path — deterministic, skip the judge entirely.
  if (analysis.readOnly) {
    return {
      decision: 'allow',
      layer: 'read_only_fastpath',
      reason: 'Read-only command — auto-allowed.',
      operation: 'read',
      triggeredBy: { kind: 'read_only' },
    }
  }

  // 2. Standing "always" rule that names this exact command.
  if (policy.approvedCommands.some((c) => norm(c) === norm(opts.command))) {
    return {
      decision: 'allow',
      layer: 'session_grant',
      reason: 'Covered by a standing authorization rule for this command.',
      operation: 'write',
      triggeredBy: { kind: 'prior_grant' },
    }
  }

  // 2b. "Approve for session": the exact command was already approved in this
  // conversation. Same-effect variants (retries with tweaked flags) fall to
  // the judge, which receives the session approvals as context.
  if (opts.sessionApprovals?.some((c) => norm(c) === norm(opts.command))) {
    return {
      decision: 'allow',
      layer: 'session_grant',
      reason: 'You already approved this command for this session.',
      operation: 'write',
      triggeredBy: { kind: 'prior_grant' },
    }
  }

  // 3. LLM judge against the policy.
  if (opts.judge) {
    const result = await opts.judge({
      command: opts.command,
      analysis,
      policy,
      sessionCommands: opts.sessionCommands,
      sessionApprovals: opts.sessionApprovals,
    })

    if (result === null) {
      // Fail-safe: an unavailable judge must never auto-allow a write.
      return {
        decision: 'require_auth',
        layer: 'judge_unavailable',
        reason:
          'Could not verify this operation automatically — requesting your authorization to be safe.',
        operation: analysis.opaque ? 'unknown' : 'write',
      }
    }
    if (!result.requireAuth) {
      const matched =
        result.matchedRuleIndex && result.matchedRuleIndex >= 1
          ? policy.rules[result.matchedRuleIndex - 1]
          : undefined

      return {
        decision: 'allow',
        layer: 'llm_judge',
        reason: matched
          ? `Auto-allowed by your rule "${matched.description}". ${result.reason}`.trim()
          : `Auto-allowed: ${result.reason}`,
        operation: result.operation,
        triggeredBy: matched
          ? { kind: 'rule', ruleId: matched.id, description: matched.description }
          : { kind: 'judge', reason: result.reason },
      }
    }

    return {
      decision: 'require_auth',
      layer: 'llm_judge',
      reason: result.reason,
      operation: result.operation,
      suggestedRule: result.suggestedRule,
    }
  }

  // 4. No judge configured: non-read-only defaults to requiring auth.
  return {
    decision: 'require_auth',
    layer: 'default_write',
    reason: 'Write operation — requires your authorization (no automatic classifier configured).',
    operation: 'write',
  }
}
