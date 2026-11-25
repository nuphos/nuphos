import { AppError } from '@/lib/errors'
import { postSlackMessage } from '@/lib/slack/api'
import { resolveSlackBotForWorkspace } from '@/lib/slack/installations'
import { escapeSlackMrkdwn } from '@/lib/slack/mrkdwn'
import { toSlackMrkdwn } from '@/lib/slack/mrkdwn/convert'

import type { SlackApiResponse } from '@/lib/slack/api'

// THE normalization boundary for agent-authored prose delivered as a Slack
// message. The agent writes CommonMark, but chat.postMessage takes `text` in
// mrkdwn: `**bold**` arrives as literal asterisks and `[label](url)` as
// literal brackets.
//
// Every path handing agent prose to chat.postMessage goes through here — the
// turn reply sink, the slack_post tool and a Bot's post in an external chat —
// and nothing else converts, since a second pass would re-read the `*bold*`
// this produced as CommonMark italics. Route-authored copy (cards,
// onboarding, notices) is already mrkdwn and keeps calling postSlackMessage
// directly.
//
// `from` names the Bot the words are from, so every path shows it the same
// way (#3702): as the post's name with chat:write.customize, otherwise as the
// line the post opens with, since Slack then shows the app's name.
export async function postAgentSlackMessage(args: {
  token: string
  channel: string
  text: string
  threadTs?: string
  blocks?: unknown[]
  from?: { name: string; slackWorkspaceId: string }
}): Promise<SlackApiResponse> {
  const { from, ...message } = args
  const text = toSlackMrkdwn(args.text)

  if (!from) return await postSlackMessage({ ...message, text })
  const post = (customize: boolean) =>
    postSlackMessage({
      ...message,
      text: customize ? text : `*${escapeSlackMrkdwn(from.name)}*\n${text}`,
      ...(customize ? { username: from.name } : {}),
    })
  // Slack does not say a custom name is ignored without chat:write.customize,
  // so a token that refuses it posts once more without one.
  const installed = await resolveSlackBotForWorkspace(from.slackWorkspaceId)
  const customize = Boolean(installed?.binding.scope.split(',').includes('chat:write.customize'))

  return await post(customize).catch(async (error: unknown) => {
    if (!customize || !(error instanceof AppError) || error.message !== 'missing_scope') throw error

    return await post(false)
  })
}
