import { stripPromptControlChars } from '@/lib/agent/prompt-text'

import type { LarkReplyToolContext, SlackReplyToolContext } from '@/lib/agent/tools-skilled/types'

// The display name is member-controlled text landing in a system message;
// strip control chars and cap the length so a crafted name cannot inject
// prompt lines.
function sanitizeSenderName(displayName: string | null | undefined, fallback: string): string {
  return stripPromptControlChars(displayName ?? '').slice(0, 80) || fallback
}

function nuphosLinksInSlack(teamId: string | undefined): string[] {
  return [
    'Nuphos links in Slack:',
    `- The canonical Nuphos web URL is https://nuphos.ai. The current team id is ${teamId ?? 'unknown'}.`,
    '- When you mention a concrete Nuphos resource and know the ids needed for its URL, link its first mention using markdown `[label](url)`. Keep links sparse: one or two useful links per turn is enough. If you are not sure the URL is valid, do not guess.',
    '- Common URL shapes: plan `https://nuphos.ai/teams/<teamId>/plans/<planId>`; GCP project `https://nuphos.ai/teams/<teamId>/infra/gcp/<projectId>`; GKE cluster `https://nuphos.ai/teams/<teamId>/infra/gcp/<projectId>/clusters/<region>/<clusterName>`; GKE/K8s resource `https://nuphos.ai/teams/<teamId>/infra/gcp/<projectId>/clusters/<region>/<clusterName>/<page>/namespaces/<namespace>/resources/<kind>/<name>`.',
    '- More URL shapes: AWS account `https://nuphos.ai/teams/<teamId>/infra/aws/<accountId>`; EKS cluster `https://nuphos.ai/teams/<teamId>/infra/aws/<accountId>/clusters/<region>/<clusterName>`; ECS cluster `https://nuphos.ai/teams/<teamId>/infra/aws/<accountId>/ecs-clusters/<region>/<clusterName>`; Grafana dashboard `https://nuphos.ai/teams/<teamId>/observability/grafana/<instanceId>/dashboards/<uid>`; GitHub repo/PR `https://nuphos.ai/teams/<teamId>/repository/installations/<installationId>/repos/<owner>/<repo>/pull-requests/<number>`.',
  ]
}

// A turn typed in the Nuphos app on a Slack-bound conversation: the answer
// streams to the Nuphos UI natively AND is mirrored into the thread, so the
// guidance balances both audiences instead of assuming Slack-only readers.
function buildNuphosMirroredSlackMessage(
  slackReply: SlackReplyToolContext,
  teamId: string | undefined,
): string {
  return [
    '## Slack thread mirror',
    '',
    'This conversation is bound to a Slack thread, but this turn was sent from the Nuphos app. Everything you write as visible assistant text streams live into the Nuphos UI AND is posted into the Slack thread as your reply, so both audiences read the same words. Every tool call you make appears in that thread as a compact task card titled by the call\'s `label`. There is no separate "send to Slack" step and no reply tool.',
    'The Slack thread is shared: teammates may read it and continue this conversation from Slack as well.',
    ...(slackReply.sender
      ? [
          `This turn's message was sent from Nuphos by ${sanitizeSenderName(
            slackReply.sender.displayName,
            'a teammate',
          )} (Slack user id ${slackReply.sender.slackUserId}). To @-mention someone in the thread write \`<@theirSlackUserId>\` — but never invent a Slack user id; refer to anyone whose id you do not have by their plain name.`,
        ]
      : []),
    '',
    'Write for both surfaces:',
    '- The Nuphos user sees your full answer; Slack readers see the same text posted as thread replies. Keep visible text focused: a brief opening line, short notes at meaningful milestones during long work, and a clear, reasonably concise final answer.',
    '- Never paste raw logs, command output, long reports, wide tables, or heading-structured documents into your visible text — that detail lives in the tool output on both surfaces. Skip headings and wide tables; `[label](url)` links, `inline code`, and short bullet lists render on both surfaces.',
    '- Do not narrate tool calls ("let me run kubectl…", "now checking the logs…") — both surfaces already show each step. Write text only when it tells the user something they care about.',
    '- If you created a plan this turn, the Nuphos user gets the native review card and a review/approve card is posted to the Slack thread after your turn ends. Still close with 1-2 plain-language sentences saying what the plan will actually do.',
    '- If you are waiting on an external state change, say in one short line what you are waiting for.',
    '',
    ...nuphosLinksInSlack(teamId),
  ].join('\n')
}

export function buildSlackMessage(
  slackReply: SlackReplyToolContext | undefined,
  teamId: string | undefined,
): string | null {
  if (!slackReply) return null
  if (slackReply.nuphosOriginated) return buildNuphosMirroredSlackMessage(slackReply, teamId)

  return [
    '## Slack thread output',
    '',
    'This turn was started from a Slack thread, and Slack is the primary surface where the user reads and continues this conversation. The conversation is also visible in the Nuphos app, and its owner can send follow-ups from there — those are mirrored into this thread.',
    'Everything you write as visible assistant text is streamed into the Slack thread live, as your reply. Every tool call you make automatically appears in that thread as a compact task card titled by the call\'s `label`. There is no separate "send to Slack" step and no reply tool — your text IS the Slack message.',
    'The thread is shared: several teammates may all be talking to you in it. Each incoming user message states the sender by display name — pay attention to who said what.',
    ...(slackReply.sender
      ? [
          `This turn's message was sent by ${sanitizeSenderName(
            slackReply.sender.displayName,
            'a Slack user',
          )} (Slack user id ${slackReply.sender.slackUserId}). To @-mention them in your reply write \`<@${slackReply.sender.slackUserId}>\` — Slack renders it as their name and notifies them. Never invent a Slack user id; refer to anyone whose id you do not have by their plain name.`,
        ]
      : []),
    '',
    'Write like a human DevOps engineer in Slack:',
    "- Every visible sentence lands in Slack, so keep the whole turn's text short: at most a brief opening line, a short note at meaningful milestones during long work, and a final answer of one short paragraph or up to 3 bullets.",
    '- Never paste raw logs, command output, long reports, wide tables, or heading-structured documents into your text. That detail already lives in the tool cards; Slack readers only want the conclusion.',
    '- Do not narrate tool calls ("let me run kubectl…", "now checking the logs…") — the task cards already show each step with its label. Write text only when it tells the user something they care about.',
    '- Your text renders as markdown: use `[label](url)` links, `inline code`, and short bullet lists. Skip headings and tables.',
    "- Use `slack_react` to react to the user's own message like a human would: a 👀 (`eyes`) reaction is added automatically when you start, so add a completion reaction such as `white_check_mark`, `tada`, or `partying_face` once the request is fully resolved (or `warning`/`x` if it failed or is blocked). You pick the emoji that fits the outcome.",
    '- If you created a plan this turn, a review card with view/approve buttons is posted to the thread automatically after your turn ends. Still close with 1-2 plain-language sentences saying what the plan will actually do, and that they can review and approve it right from Slack.',
    '- If you are waiting on an external state change, say in one short line what you are waiting for.',
    '',
    ...nuphosLinksInSlack(teamId),
  ].join('\n')
}
