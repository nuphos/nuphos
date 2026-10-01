import { postSlackMessage } from '@/lib/slack/api'
import { toSlackMrkdwn } from '@/lib/slack/mrkdwn/convert'

import type { SlackApiResponse } from '@/lib/slack/api'

// THE normalization boundary for agent-authored prose delivered as a Slack
// message. The agent writes CommonMark, but chat.postMessage takes `text` in
// mrkdwn: `**bold**` arrives as literal asterisks and `[label](url)` as
// literal brackets.
//
// Every path handing agent prose to chat.postMessage goes through here — the
// turn reply sink and the slack_post tool — and nothing else converts, since
// a second pass would re-read the `*bold*` this produced as CommonMark
// italics. Route-authored copy (cards, onboarding, notices) is already mrkdwn
// and keeps calling postSlackMessage directly.
export async function postAgentSlackMessage(args: {
  token: string
  channel: string
  text: string
  threadTs?: string
  blocks?: unknown[]
}): Promise<SlackApiResponse> {
  return await postSlackMessage({ ...args, text: toSlackMrkdwn(args.text) })
}
