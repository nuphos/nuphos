import { tool } from 'ai'
import { z } from 'zod'

import { isAutoModeApprovalEnabled as isAutoModeEnabled } from '../auto-mode/approval'
import {
  addRule as proposeAutoModeRuleRaw,
  RuleValidationError,
  RULE_DESCRIPTION_MAX_LENGTH,
} from '../auto-mode/store'

import { labelField, withLabel } from './labeling'

import type { ExplicitUserDecision } from './types'
import type { AgentSessionOrigin } from '../tools-triggers'

type UserDecisionDeps = {
  agentOrigin: AgentSessionOrigin
  onExplicitUserDecision?: (decision: ExplicitUserDecision) => void
}

export function createUserDecisionTools(deps: UserDecisionDeps): Record<string, unknown> {
  const { agentOrigin, onExplicitUserDecision } = deps
  const userDecisionTools: Record<string, unknown> = {}

  if (agentOrigin === 'user' && onExplicitUserDecision) {
    userDecisionTools.request_user_decision = tool({
      description:
        'Declare that the current task is genuinely blocked on a choice only the user can make, then end the turn with exactly that concise question. ' +
        'Use this ONLY for a real preference, approval for a risky/costly/irreversible action, a credential or secret the tools cannot obtain, an integration the user must connect, or a material risk tradeoff. ' +
        'Do not use it for facts you can inspect, safe read-only work, optional follow-ups, or to avoid finishing the task. ' +
        'After this tool returns, do not run more tools or make the choice yourself; ask the question from `question`, include the supplied options when present, and wait for the next user message.',
      inputSchema: z.object({
        label: labelField,
        category: z.enum(['preference', 'approval', 'credential', 'integration', 'risk_tradeoff']),
        question: z
          .string()
          .trim()
          .min(1)
          .max(1_000)
          .describe('The single concise question to show the user, in their language.'),
        options: z
          .array(z.string().trim().min(1).max(300))
          .min(2)
          .max(5)
          .optional()
          .describe('Two to five concrete choices when the decision has a finite menu.'),
      }),
      execute: async (input) => {
        const { label: _label, category, question, options } = input
        const decision: ExplicitUserDecision = options
          ? { category, question, options }
          : { category, question }

        onExplicitUserDecision(decision)

        return {
          ok: true,
          status: 'awaiting_user_decision',
          ...decision,
          instruction:
            'End the turn now with this question and wait for the user. Do not continue the task or choose on their behalf.',
        }
      },
    })
  }

  return userDecisionTools
}

type AutoModeDeps = {
  userId: string
  conversationId: string
  onAwaitUserDecision?: () => void
}

// Auto Mode: when the user tells the agent to stop asking for a class of
// operation ("以後 staging 的 restart 都不用問我"), the agent PROPOSES a
// standing rule. It does NOT take effect until the user confirms it in the
// settings list — the agent can't unilaterally weaken authorization.
export function createAutoModeTools(deps: AutoModeDeps): Record<string, unknown> {
  const { userId, conversationId, onAwaitUserDecision } = deps
  const autoModeTools: Record<string, unknown> = {}

  if (isAutoModeEnabled() && onAwaitUserDecision) {
    autoModeTools.propose_authorization_rule = withLabel(
      {
        description:
          "Propose a standing Auto Mode authorization rule when the user EXPLICITLY asks you to stop requiring approval for a CLASS of operations (e.g. 'from now on you can restart staging deployments without asking'). " +
          'HOW TO WRITE `description` (important): ' +
          '(1) ONE short, plain-language phrase naming the KIND of operation — aim for under ~12 words. ' +
          'Do NOT include API paths, URLs, HTTP methods, command syntax, or implementation detail — the rule is matched semantically by an LLM judge, so a short human phrase is clearer and safer than a verbose spec. ' +
          "(2) Write it in the SAME LANGUAGE as the user's most recent message — if the user wrote Chinese, the rule MUST be Chinese. " +
          "(3) Keep the SCOPE narrow but say it concisely; you may note one key exclusion in the same phrase if it matters (e.g. '(不含 datasource 與 alert)'). " +
          'The rule is PROPOSED only — it does not take effect until the user confirms it. Never propose a rule covering deletes, production, or other irreversible operations; those always require per-command approval. Only call this on an explicit user instruction, not on your own initiative.',
        inputSchema: undefined,
        execute: async (input: { description?: string }) => {
          const description = (input?.description ?? '').trim()

          if (!description) return { ok: false, error: 'description is required' }
          let rule

          try {
            rule = await proposeAutoModeRuleRaw(
              userId,
              description,
              userId,
              'proposed',
              conversationId,
            )
          } catch (err) {
            if (err instanceof RuleValidationError) {
              return {
                ok: false,
                error:
                  err.code === 'rule_description_too_long'
                    ? `description is too long — use a short plain-language phrase (max ${String(RULE_DESCRIPTION_MAX_LENGTH)} characters), not a command`
                    : 'description is required',
              }
            }
            throw err
          }
          // Pause the turn: the user must Confirm/Dismiss the proposal inline
          // before you continue. Do NOT keep working or narrate further.
          onAwaitUserDecision?.()

          return {
            ok: true,
            status: 'proposed',
            ruleId: rule.id,
            message: `Proposed rule "${description}". The turn now pauses for the user to Confirm or Dismiss it inline — do not continue or say more.`,
          }
        },
      },
      {
        description: z
          .string()
          .describe(
            "Short plain-language phrase (~12 words max) naming the operation class to auto-allow, in the USER'S language. No API paths, URLs, HTTP methods, or command syntax.",
          ),
      },
    )
  }

  return autoModeTools
}
