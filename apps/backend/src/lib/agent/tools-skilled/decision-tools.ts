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
  'plaud',
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

/** A secret's name: also the file name it is written to on the runtime. */
export const SECRET_NAME = /^[A-Za-z]\w{0,63}$/

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
        'For an integration or cloud account the task needs that is not connected to the team, or connected but not selected for this conversation, use category `integration` and list it in `providers`: in the Desktop app the user then gets a Connect card for it. ' +
        'Name only providers the task actually needs. Do not use `providers` when the credential is already selected and a call fails with AccessDenied or 403 (connecting another account does not fix missing permissions), or for MCP servers. ' +
        'For an API key, password or other secret only the user can type, use category `credential` with `secretName`: in the Desktop app the user then gets a masked input that writes the value to a file on this runtime, never into the conversation. Never ask the user to paste a secret into chat. ' +
        'After this tool returns, do not run more tools or make the choice yourself; follow the returned instruction, include the supplied options when present, and wait for the next user message.',
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
        providers: z
          .array(z.enum(CONNECTABLE_PROVIDERS))
          .min(1)
          .max(6)
          .optional()
          .describe('With category `integration`: the integrations or cloud accounts to connect.'),
        secretName: z
          .string()
          .regex(SECRET_NAME)
          .optional()
          .describe(
            'With category `credential`: an environment-variable style name for the secret the user types, e.g. OPENAI_API_KEY.',
          ),
      }),
      execute: async (input) => {
        const { label: _label, category, question, options } = input
        const providers = category === 'integration' ? input.providers : undefined
        const secretName = category === 'credential' ? input.secretName : undefined
        const decision: ExplicitUserDecision = options
          ? { category, question, options }
          : { category, question }

        onExplicitUserDecision(decision)

        return {
          ok: true,
          status: 'awaiting_user_decision',
          ...decision,
          ...(providers ? { providers } : {}),
          ...(secretName ? { secretName } : {}),
          instruction: providers
            ? 'The user sees a Connect card for these below your message. End the turn with one short sentence that refers to "the card below" (never "above") and wait; once connected, the credential is selected for this conversation and they will ask you to continue.'
            : secretName
              ? 'The user sees a secure input card below your message. End the turn with one short sentence that refers to "the card below" (never "above") and wait. Their next message gives the path of a file holding the value: read it only inside the command that needs it, e.g. "$(cat <path>)", and never print, echo or copy its contents.'
              : 'End the turn now with this question and wait for the user. Do not continue the task or choose on their behalf.',
        }
      },
    })
  }

  return userDecisionTools
}
