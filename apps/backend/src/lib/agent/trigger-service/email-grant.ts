// A standing email grant lets a cron Trigger's fires mail recipients nobody
// named (#2467). The prompt tells an agent to write one only after the user
// approves it; this makes that rule hold on the server, so a confused or
// prompt-injected turn cannot leave a lasting permission behind.
import { AppError } from '@/lib/errors'

import { getConversationBySessionId } from '../db'

import type { InputRequest } from '../db/pending-decision'
import type { TriggerType } from '../trigger-db'

/** The one answer that approves a grant. A fixed label, so a card cannot dress up a refusal as approval. */
export const APPROVE_EMAIL_GRANT = 'Approve this grant'

const normalize = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim().replace(/\s+/gu, ' '))
    .join('\n')

/**
 * Every grant block in an instruction: a line that mentions a standing email
 * grant, through the next blank line. Matching is loose on purpose, so a block
 * the agent would read as a grant cannot slip past by its spelling.
 */
export function emailGrantBlocks(template: string | undefined): string[] {
  const lines = normalize(template ?? '').split('\n')
  const blocks: string[] = []

  lines.forEach((line, index) => {
    if (!/standing\s+email\s+grant/iu.test(line)) return
    const end = lines.findIndex((next, at) => at > index && !next)

    blocks.push(lines.slice(index, end === -1 ? lines.length : end).join('\n'))
  })

  return blocks
}

/** An approval card the principal answered with the fixed approval, quoting the exact block. */
export function approvesEmailGrant(
  request: InputRequest,
  block: string,
  principalUserId: string,
): boolean {
  return (
    request.category === 'approval' &&
    request.status === 'answered' &&
    !request.questions?.length &&
    request.answeredBy === principalUserId &&
    request.answerChoices?.length === 1 &&
    request.answerChoices[0] === APPROVE_EMAIL_GRANT &&
    // Whole lines, so a card quoting `cap: 200` does not approve a block ending in `cap: 20`.
    `\n${normalize(request.body ?? '')}\n`.includes(`\n${block}\n`)
  )
}

/**
 * Rejects an instruction write that adds or changes a grant block unless the
 * writing conversation holds an approval for each new block. Keeping or
 * removing a block needs nothing. A webhook Trigger never holds one.
 */
export async function assertEmailGrantAuthorized(args: {
  previous?: string
  next: string
  triggerType: TriggerType
  principalUserId: string
  sessionId?: string
}): Promise<void> {
  const blocks = emailGrantBlocks(args.next)

  if (!blocks.length) return
  if (args.triggerType !== 'cron')
    throw new AppError(
      400,
      'email_grant_webhook',
      'A standing email grant can only be held by a cron Trigger',
    )
  const kept = new Set(emailGrantBlocks(args.previous))
  const added = blocks.filter((block) => !kept.has(block))

  if (!added.length) return
  const requests = args.sessionId
    ? ((await getConversationBySessionId(args.sessionId))?.inputRequests ?? [])
    : []

  if (
    added.every((block) =>
      requests.some((request) => approvesEmailGrant(request, block, args.principalUserId)),
    )
  )
    return
  throw new AppError(
    403,
    'email_grant_not_approved',
    `Adding or changing a standing email grant needs the Trigger owner's approval first: in this conversation, ask with request_user_decision, category "approval", the exact block in its body and "${APPROVE_EMAIL_GRANT}" as an option, and write it after they pick that option.`,
  )
}
