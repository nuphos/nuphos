import { tool } from 'ai'
import { z } from 'zod'

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
