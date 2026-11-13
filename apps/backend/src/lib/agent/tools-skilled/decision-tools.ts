import { tool } from 'ai'
import { z } from 'zod'

import { aboutField } from './decision-about'
import { labelField, withLabel } from './labeling'

import type { ExplicitUserDecision } from './types'
import type { AgentSessionOrigin } from '@/lib/agent/message-origin'
import type { SelectionKey } from '@/lib/claude-code-preview/credential-lister'

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
  trello: 'trelloIntegrationIds',
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

/** The member's own credential, named as list_credentials names it: only its selection answers. */
export const PERSONAL_CREDENTIAL_REF = z
  .object({ provider: z.literal('personal'), id: z.enum(['github', 'linear']) })
  .strict()

export type PersonalCredentialRef = z.infer<typeof PERSONAL_CREDENTIAL_REF>

export function isPersonalCredentialRef(value: unknown): value is PersonalCredentialRef {
  return PERSONAL_CREDENTIAL_REF.safeParse(value).success
}

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
const multiSelectField = z
  .boolean()
  .describe('The user may pick any number of the options, not just one.')
const subQuestionField = z
  .object({
    question: questionField,
    options: optionsField.optional(),
    multiSelect: multiSelectField.optional(),
  })
  .strict()
const questionsField = z
  .array(subQuestionField)
  .min(2)
  .max(4)
  .describe(
    'Two to four related questions answered together in one card, each with its own options. `question` is then the headline over them.',
  )
const requestIdField = z
  .string()
  .min(1)
  .max(200)
  .describe('The requestId request_user_decision returned.')

/**
 * Why an integration request names its target wrongly: `credentials` takes only
 * the member's own credential, and never together with `providers`, which asks
 * for any access of a kind; mixing them would leave it unclear what answers it.
 */
export function integrationTargetProblem(input: {
  providers?: unknown
  credentials?: unknown
}): string | null {
  if (input.credentials === undefined) return null
  if (!Array.isArray(input.credentials) || !input.credentials.every(isPersonalCredentialRef)) {
    return "`credentials` names only the member's own credential, {provider: 'personal', id: 'github' | 'linear'}; ask for team access with `providers`."
  }
  if (input.providers !== undefined) {
    return "Pass either `providers` (any access of that kind, a team binding included) or `credentials` (only the member's own), not both: ask one question per target."
  }

  return null
}

type WrittenQuestion = { question: string; options?: string[]; multiSelect?: boolean }

/**
 * A card's questions written out as markdown after a `---` separator, for
 * clients that draw only `question` and `body`. Each question and option is
 * one line. Desktop and iOS build the same text to find and drop it.
 */
export function writtenQuestions(questions: readonly WrittenQuestion[]): string {
  const line = (text: string) => text.replace(/\s+/g, ' ').trim()
  const list = questions
    .map(({ question, options, multiSelect }, index) =>
      [
        `**${String(index + 1)}. ${line(question)}**${multiSelect ? ' (any number)' : ''}`,
        ...(options ?? []).map((option) => `- ${line(option)}`),
      ].join('\n'),
    )
    .join('\n\n')

  return `\n\n---\n\n${list}`
}

/** A card's body with its `questions` written out after it. */
export function withQuestionsInBody(input: {
  body?: string
  questions?: readonly WrittenQuestion[]
}): string | undefined {
  if (!input.questions?.length) return input.body

  return `${input.body ?? ''}${writtenQuestions(input.questions)}`
}

/** The body the agent wrote: without its questions' written-out list, only when it ends with exactly that. */
export function ownBody(
  body: string | undefined,
  questions: readonly WrittenQuestion[] | undefined,
): string | undefined {
  const written = questions?.length ? writtenQuestions(questions) : undefined

  return written && body?.endsWith(written) ? body.slice(0, -written.length) || undefined : body
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
        'Ask the user a choice only they can make, as a card they answer in the conversation or their Inbox. ' +
        'Use this ONLY for a real preference, approval for a risky/costly/irreversible action, a credential or secret the tools cannot obtain, an integration the user must connect, or a material risk tradeoff. ' +
        'Do not use it for facts you can inspect, safe read-only work, optional follow-ups, or to avoid finishing the task. ' +
        'For an integration or cloud account the task needs that is not connected to the team, or connected but not selected for this conversation, use category `integration` and list it in `providers`: in the Desktop app the user then gets a Connect card for it. ' +
        "`providers` asks for any access of that kind: a team binding answers it too. For the member's own credential that list_credentials shows under `notSelected` (provider `personal`), pass it in `credentials` as that (provider, id) pair instead: only selecting it answers the question. Ask for it only when the task needs the member's own token, not to act as them on a team binding. " +
        'Never ask in a free-text question to tick a credential in the picker: only a question with `providers` resolves itself, and resumes you, once that credential is selected, by the user or by a parent agent. ' +
        'Name only providers the task actually needs. Do not use `providers` when the credential is already selected and a call fails with AccessDenied or 403 (connecting another account does not fix missing permissions), or for MCP servers. ' +
        'For an API key, password or other secret only the user can type, use category `credential` with `secretName`: in the Desktop app the user then gets a masked input that writes the value to a file on this runtime, never into the conversation. Never ask the user to paste a secret into chat. ' +
        'Put choices in `options`, never in the question text; set `multiSelect` when several may apply. The user can always answer in their own words instead. ' +
        'Ask related questions together in one call through `questions` rather than one card after another; `question` is then the headline. ' +
        'The question is listed in the Inbox until answered: put what the user needs to decide in `body`, so they can answer there without reading the chat. ' +
        'When it is about a PR or issue linked with bind_session_resource, or another of your conversations (a sub-agent thread, or the session that will act on the answer), name them in `about`: their changes then remind you of the question, to withdraw or update it, and the conversations named are told the answer too, so they need not ask again. ' +
        'The result carries a `requestId`; while the question is open, update_user_decision corrects it and withdraw_user_decision removes it once it no longer applies. ' +
        'After it returns, never make the choice yourself or do the work that depends on it. You may continue with work that does not depend on the answer, or end your turn: the answer arrives as a new message either way.',
      // Strict: a misnamed field, e.g. `choices` for `options`, is refused rather than dropped.
      inputSchema: z.strictObject({
        label: labelField,
        category: z.enum(['preference', 'approval', 'credential', 'integration', 'risk_tradeoff']),
        question: questionField,
        body: bodyField.optional(),
        options: optionsField.optional(),
        multiSelect: multiSelectField.optional(),
        questions: questionsField.optional(),
        providers: z
          .array(z.enum(PROVIDER_NAMES))
          .min(1)
          .max(6)
          .optional()
          .describe('With category `integration`: the integrations or cloud accounts to connect.'),
        credentials: z
          .array(PERSONAL_CREDENTIAL_REF)
          .min(1)
          .max(2)
          .optional()
          .describe(
            "With category `integration`: the member's own credential, as the (provider, id) pair list_credentials shows, e.g. {provider: 'personal', id: 'github'}.",
          ),
        secretName: z
          .string()
          .regex(SECRET_NAME)
          .optional()
          .describe(
            'With category `credential`: an environment-variable style name for the secret the user types, e.g. OPENAI_API_KEY.',
          ),
        about: aboutField.optional(),
      }),
      execute: async (input) => {
        const problem = integrationTargetProblem(input)

        if (problem) throw new Error(problem)
        const { label: _label, category, question, body, options, multiSelect, questions } = input
        const providers = category === 'integration' ? input.providers : undefined
        const credentials = category === 'integration' ? input.credentials : undefined
        const secretName = category === 'credential' ? input.secretName : undefined
        const decision: ExplicitUserDecision = {
          category,
          question,
          ...(body ? { body } : {}),
          ...(options ? { options } : {}),
          ...(options && multiSelect ? { multiSelect } : {}),
          ...(questions ? { questions } : {}),
        }

        onExplicitUserDecision(decision)

        return {
          ok: true,
          status: 'awaiting_user_decision',
          ...decision,
          ...(providers ? { providers } : {}),
          ...(credentials ? { credentials } : {}),
          ...(secretName ? { secretName } : {}),
          instruction:
            providers || credentials
              ? 'The user sees a Connect card for these below your message; point to it in one short sentence that refers to "the card below" (never "above"). Once one is selected for this conversation, you are told so in a new message and continue from there.'
              : secretName
                ? 'The user sees a secure input card below your message; point to it in one short sentence that refers to "the card below" (never "above"). Their answer, a new message, gives the path of a file holding the value: read it only inside the command that needs it, e.g. "$(cat <path>)", and never print, echo or copy its contents.'
                : 'Do not choose on their behalf or do the work that depends on the answer. Continue only with work that does not depend on it, or end your turn; the answer arrives as a new message.',
        }
      },
    })
    // No execute: these change the stored request, so only the runtime that keeps it handles them.
    userDecisionTools.update_user_decision = tool({
      description:
        'Correct a question you asked with request_user_decision that is still waiting for the user, e.g. when new findings change its context or choices. ' +
        'Pass only the fields to change; `questions` replaces all of them. Fails once the user has answered or dismissed it.',
      inputSchema: z.object({
        label: labelField,
        requestId: requestIdField,
        question: questionField.optional(),
        body: bodyField.optional(),
        options: optionsField.optional(),
        multiSelect: multiSelectField.optional(),
        questions: questionsField.optional(),
      }),
    })
    userDecisionTools.withdraw_user_decision = tool({
      description:
        'Withdraw a question you asked with request_user_decision that no longer needs an answer, so it leaves the Inbox. ' +
        'Fails once the user has answered or dismissed it.',
      inputSchema: z.object({ label: labelField, requestId: requestIdField }),
    })
    userDecisionTools.list_user_decisions = tool({
      description:
        'List the questions you asked with request_user_decision that are still waiting for the user, oldest first, each with its `requestId`. ' +
        'Check it before asking again, and to find the requestId for update_user_decision or withdraw_user_decision.',
      inputSchema: z.object({ label: labelField }),
    })
  }

  return userDecisionTools
}
