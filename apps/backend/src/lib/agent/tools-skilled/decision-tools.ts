import { tool } from 'ai'
import { z } from 'zod'

import { labelField, withLabel } from './labeling'

import type { ExplicitUserDecision } from './types'
import type { AgentSessionOrigin } from '../tools-triggers'

// Connectors the desktop's in-chat Connect card can bind and then select for the
// conversation. Each maps to a field of the conversation's credential selection.
export const CONNECTABLE_PROVIDERS = [
  'github',
  'gitlab',
  'linear',
  'jira',
  'asana',
  'sentry',
  'posthog',
  'grafana',
  'sonarqube',
  'notion',
  'upstash',
  'resend',
  'cloudflare',
  'betterstack',
  'uptime-kuma',
  'tailscale',
  'zeabur',
  'vanta',
  'secureframe',
  'aws',
  'gcp',
  'azure',
  'linode',
  'hetzner',
  'tencent',
  'aliyun',
  'volcengine',
  'huawei',
  'onprem-k8s',
] as const

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
    userDecisionTools.request_connection = tool({
      description:
        'Show the user an inline Connect card for integrations or cloud accounts this task needs but cannot use yet: ' +
        'not connected to the team, or connected but not selected for this conversation. ' +
        'Each row connects through the same flow as the Integrations page, and the new credential is selected for this conversation automatically. ' +
        'Use it instead of telling the user to visit Integrations or tick the credential picker. ' +
        'The card renders below your final message, so refer to it as "the card below" or "the card", never "above". ' +
        'After this tool returns, end the turn with one short sentence; the user continues once connected.',
      inputSchema: z.object({
        label: labelField,
        providers: z.array(z.enum(CONNECTABLE_PROVIDERS)).min(1).max(6),
        reason: z
          .string()
          .trim()
          .min(1)
          .max(300)
          .describe('One line on why the task needs these connections, in the user’s language.'),
      }),
      execute: async (input) => {
        const { providers, reason } = input
        const question = `Connect ${providers.join(', ')} to continue: ${reason}`

        onExplicitUserDecision({ category: 'integration', question })

        return {
          ok: true,
          status: 'awaiting_connection',
          providers,
          reason,
          instruction:
            'The user sees a Connect card below your message. End the turn with one short sentence that calls it "the card below" (never "above") and wait; do not tell them to open Integrations or the credential picker. ' +
            'Once they connect, the credential is selected for this conversation and they will ask you to continue.',
        }
      },
    })
  }

  return userDecisionTools
}
