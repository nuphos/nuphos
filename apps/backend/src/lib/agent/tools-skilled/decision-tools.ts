import { tool } from 'ai'
import { z } from 'zod'

import { labelField, withLabel } from './labeling'

import type { ExplicitUserDecision } from './types'
import type { SelectionKey } from '@/lib/claude-code-preview/credential-lister'
import type { AgentSessionOrigin } from '../tools-triggers'

// Connectors the desktop's in-chat Connect card can bind and then select for the
// conversation, each with the field of the conversation's credential selection
// its bindings land in. Selecting one there answers the question that asked for it.
export const CONNECTABLE_PROVIDERS = {
  github: 'githubInstallationIds',
  gitlab: 'gitlabBindingIds',
  linear: 'linearWorkspaceIds',
  jira: 'jiraSiteIds',
  asana: 'asanaAccountIds',
  sentry: 'sentryAccountIds',
  posthog: 'posthogIntegrationIds',
  plaud: 'plaudAccountIds',
  grafana: 'grafanaInstanceIds',
  sonarqube: 'sonarqubeIntegrationIds',
  notion: 'notionIntegrationIds',
  upstash: 'upstashAccountIds',
  resend: 'resendIntegrationIds',
  cloudflare: 'cloudflareAccountIds',
  betterstack: 'betterStackIntegrationIds',
  'uptime-kuma': 'uptimeKumaInstanceIds',
  tailscale: 'tailscaleClientIds',
  zeabur: 'zeaburIds',
  vanta: 'vantaIntegrationIds',
  secureframe: 'secureframeIntegrationIds',
  aws: 'awsRoleIds',
  gcp: 'gcpServiceAccountIds',
  azure: 'azureAccountIds',
  linode: 'linodeAccountIds',
  hetzner: 'hetznerAccountIds',
  tencent: 'tencentAccountIds',
  aliyun: 'aliyunAccountIds',
  volcengine: 'volcengineAccountIds',
  huawei: 'huaweiAccountIds',
  'onprem-k8s': 'onpremClusterIds',
} as const satisfies Record<string, SelectionKey>

export type ConnectableProvider = keyof typeof CONNECTABLE_PROVIDERS

const PROVIDER_NAMES = Object.keys(CONNECTABLE_PROVIDERS) as [
  ConnectableProvider,
  ...ConnectableProvider[],
]

export function isConnectableProvider(name: unknown): name is ConnectableProvider {
  return typeof name === 'string' && Object.hasOwn(CONNECTABLE_PROVIDERS, name)
}

/** A secret's name: also the file name it is written to on the runtime. */
export const SECRET_NAME = /^[A-Za-z]\w{0,63}$/

const questionField = z
  .string()
  .trim()
  .min(1)
  .max(1_000)
  .describe('The single concise question to show the user, in their language.')
const bodyField = z
  .string()
  .trim()
  .min(1)
  .max(8_000)
  .describe(
    'Markdown the user decides from: the relevant findings, what each choice does, and its risk.',
  )
const optionsField = z
  .array(z.string().trim().min(1).max(300))
  .min(2)
  .max(5)
  .describe('Two to five concrete choices when the decision has a finite menu.')
const requestIdField = z
  .string()
  .min(1)
  .max(200)
  .describe('The requestId request_user_decision returned.')

// Numbered items that each end in a question mark: several questions in one.
const NUMBERED_ITEM = /(?:^|\s)\d{1,2}(?:[.)]\s|、)/g
const QUESTION_MARK = /[?？]/g
// A "(Recommended)" marker is how a choice written into the text gives itself away.
const INLINE_CHOICE = /[(（]\s*recommended\s*[)）]/i

/**
 * Why a question cannot become one answerable card, or null when it can:
 * several questions in one, or choices written into the text instead of
 * `options`. Cards answer one question with buttons, so either breaks them.
 */
export function decisionQuestionProblem(input: {
  question: string
  options?: readonly string[]
}): string | null {
  const items = input.question.match(NUMBERED_ITEM)?.length ?? 0
  const marks = input.question.match(QUESTION_MARK)?.length ?? 0

  if (items >= 2 && marks >= 2)
    return 'This asks several questions at once. Call request_user_decision once per question, each with its own options, and end the turn after the first; ask the next one after the user answers.'
  if (!input.options?.length && INLINE_CHOICE.test(input.question))
    return 'The choices are written into the question. Pass them in `options` (two to five, the recommended one first) and keep `question` to the question itself.'

  return null
}

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
        'This includes a personal credential list_credentials shows under `notSelected` (provider `personal`): name its id, `github` or `linear`, in `providers`. ' +
        'Never ask in a free-text question to tick a credential in the picker: only a question with `providers` resolves itself, and resumes you, once that credential is selected, by the user or by a parent agent. ' +
        'Name only providers the task actually needs. Do not use `providers` when the credential is already selected and a call fails with AccessDenied or 403 (connecting another account does not fix missing permissions), or for MCP servers. ' +
        'For an API key, password or other secret only the user can type, use category `credential` with `secretName`: in the Desktop app the user then gets a masked input that writes the value to a file on this runtime, never into the conversation. Never ask the user to paste a secret into chat. ' +
        'Ask exactly one question per call, and put its choices in `options`, never in the question text: the user answers with one button per option. ' +
        'The question is listed in the Inbox until answered: put what the user needs to decide in `body`, so they can answer there without reading the chat. ' +
        'The result carries a `requestId`; while the question is open, update_user_decision corrects it and withdraw_user_decision removes it once it no longer applies. ' +
        'After this tool returns, do not run more tools or make the choice yourself; follow the returned instruction, include the supplied options when present, and wait for the next user message.',
      inputSchema: z.object({
        label: labelField,
        category: z.enum(['preference', 'approval', 'credential', 'integration', 'risk_tradeoff']),
        question: questionField,
        body: bodyField.optional(),
        options: optionsField.optional(),
        providers: z
          .array(z.enum(PROVIDER_NAMES))
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
        const problem = decisionQuestionProblem(input)

        if (problem) throw new Error(problem)
        const { label: _label, category, question, body, options } = input
        const providers = category === 'integration' ? input.providers : undefined
        const secretName = category === 'credential' ? input.secretName : undefined
        const decision: ExplicitUserDecision = {
          category,
          question,
          ...(body ? { body } : {}),
          ...(options ? { options } : {}),
        }

        onExplicitUserDecision(decision)

        return {
          ok: true,
          status: 'awaiting_user_decision',
          ...decision,
          ...(providers ? { providers } : {}),
          ...(secretName ? { secretName } : {}),
          instruction: providers
            ? 'The user sees a Connect card for these below your message. End the turn with one short sentence that refers to "the card below" (never "above") and wait; once one is selected for this conversation, you are told so in a new message and continue from there.'
            : secretName
              ? 'The user sees a secure input card below your message. End the turn with one short sentence that refers to "the card below" (never "above") and wait. Their next message gives the path of a file holding the value: read it only inside the command that needs it, e.g. "$(cat <path>)", and never print, echo or copy its contents.'
              : 'End the turn now with this question and wait for the user. Do not continue the task or choose on their behalf.',
        }
      },
    })
    // No execute: these change the stored request, so only the runtime that keeps it handles them.
    userDecisionTools.update_user_decision = tool({
      description:
        'Correct a question you asked with request_user_decision that is still waiting for the user, e.g. when new findings change its context or choices. ' +
        'Pass only the fields to change. Fails once the user has answered or dismissed it.',
      inputSchema: z.object({
        label: labelField,
        requestId: requestIdField,
        question: questionField.optional(),
        body: bodyField.optional(),
        options: optionsField.optional(),
      }),
    })
    userDecisionTools.withdraw_user_decision = tool({
      description:
        'Withdraw a question you asked with request_user_decision that no longer needs an answer, so it leaves the Inbox. ' +
        'Fails once the user has answered or dismissed it.',
      inputSchema: z.object({ label: labelField, requestId: requestIdField }),
    })
  }

  return userDecisionTools
}
