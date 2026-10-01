import { postSlackMessage } from '@/lib/slack/api'
import { escapeSlackMrkdwn } from '@/lib/slack/mrkdwn'
import { truncatePlain } from '@/routes/slack/shared'

import type { SlackRuntime } from '@/routes/slack/types'

export const TOOL_APPROVAL_ALLOW_ACTION = 'nuphos_tool_approval_allow'
export const TOOL_APPROVAL_REJECT_ACTION = 'nuphos_tool_approval_reject'

type ToolApprovalOption = { optionId: string; name: string; kind: string }

export function buildToolApprovalBlocks(args: {
  sessionId: string
  toolCallId: string
  title: string
  options: ToolApprovalOption[]
}): unknown[] {
  const value = JSON.stringify({ sessionId: args.sessionId, toolCallId: args.toolCallId })
  const allowOnce = args.options.some((option) => option.kind === 'allow_once')
  const buttons: unknown[] = []

  if (allowOnce) {
    buttons.push({
      type: 'button',
      style: 'primary',
      action_id: TOOL_APPROVAL_ALLOW_ACTION,
      text: { type: 'plain_text', text: 'Allow once', emoji: true },
      value,
      confirm: {
        title: { type: 'plain_text', text: 'Allow this tool once?' },
        text: {
          type: 'mrkdwn',
          text: `Nuphos will run *${escapeSlackMrkdwn(truncatePlain(args.title, 160))}* once using your selected credentials.`,
        },
        confirm: { type: 'plain_text', text: 'Allow once' },
        deny: { type: 'plain_text', text: 'Cancel' },
      },
    })
  }
  buttons.push({
    type: 'button',
    style: 'danger',
    action_id: TOOL_APPROVAL_REJECT_ACTION,
    text: { type: 'plain_text', text: 'Reject', emoji: true },
    value,
  })

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🔐 *Tool approval required*\n${escapeSlackMrkdwn(truncatePlain(args.title, 500))}`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: allowOnce
            ? 'Only the person whose credentials this turn is using can decide. This request expires in about 2 minutes.'
            : 'The runtime did not offer a one-time allow option, so this request can only be rejected.',
        },
      ],
    },
    { type: 'actions', elements: buttons },
  ]
}

export async function postToolApprovalCard(args: {
  runtime: SlackRuntime
  channel: string
  threadTs: string
  sessionId: string
  toolCallId: string
  title: string
  options: ToolApprovalOption[]
}): Promise<void> {
  await postSlackMessage({
    token: args.runtime.botToken,
    channel: args.channel,
    threadTs: args.threadTs,
    text: `Tool approval required: ${truncatePlain(args.title, 300)}`,
    blocks: buildToolApprovalBlocks(args),
  })
}
