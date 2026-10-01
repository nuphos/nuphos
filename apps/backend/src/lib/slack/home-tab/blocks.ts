import { escapeSlackMrkdwn } from '@/lib/slack/mrkdwn'

import type { NuphosTeamRole } from '@/lib/identity'

// ─── App Home (Home tab) ─────────────────────────────────────────────────────
// The Home tab is published per user via views.publish on app_home_opened, so
// it can show the viewer's own state: which Nuphos team this Slack workspace is
// connected to, whether THEIR Slack account is linked to a Nuphos user, and
// which of the team's cloud credentials their allowlists actually grant.

// Re-publishes the Home view with fresh data (block_actions in /interactions).
export const HOME_REFRESH_ACTION = 'nuphos_home_refresh'

export type SlackHomeCredentialGroup = { provider: string; entries: string[] }

export type SlackHomeViewModel = {
  slackTeamName: string
  botUserId: string
  teamName: string
  // Null when the viewer's Slack account has no enabled mapping to a current
  // team member — the view then explains how linking works instead of showing
  // member-scoped data.
  viewer: { name: string; email: string; role: NuphosTeamRole | null } | null
  linkedChannelIds: string[]
  credentials: SlackHomeCredentialGroup[]
}

// Home views cap at 100 blocks; one section per provider (~9 providers) plus
// the fixed sections stays far below that. Entry lists are capped per provider
// so a credential-heavy team cannot blow the 3000-char section ceiling.
const MAX_CREDENTIAL_ENTRIES_PER_PROVIDER = 10
const MAX_CREDENTIAL_ENTRY_LENGTH = 120
const MAX_LINKED_CHANNELS_SHOWN = 30

// Credential labels are team-supplied free text; rendered inside inline code
// spans, so backticks would break out of the span.
function credentialEntry(value: string): string {
  const cleaned = value.replace(/`/g, '').trim()
  const truncated =
    cleaned.length > MAX_CREDENTIAL_ENTRY_LENGTH
      ? `${cleaned.slice(0, MAX_CREDENTIAL_ENTRY_LENGTH - 1)}…`
      : cleaned

  return escapeSlackMrkdwn(truncated)
}

export function credentialBlocks(model: SlackHomeViewModel): unknown[] {
  const blocks: unknown[] = [
    { type: 'section', text: { type: 'mrkdwn', text: '*☁️ Cloud credentials you can use*' } },
  ]

  if (!model.viewer) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '_Link your Nuphos account to see which credentials are available to you._',
        },
      ],
    })

    return blocks
  }
  if (model.credentials.length === 0) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '_No cloud credentials are available to you yet. Add them in the Nuphos desktop app → Settings._',
        },
      ],
    })

    return blocks
  }
  for (const group of model.credentials) {
    const shown = group.entries.slice(0, MAX_CREDENTIAL_ENTRIES_PER_PROVIDER)
    const lines = shown.map((entry) => `• \`${credentialEntry(entry)}\``)
    const hidden = group.entries.length - shown.length

    if (hidden > 0) lines.push(`• _+${String(hidden)} more_`)
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${group.provider}*\n${lines.join('\n')}` },
    })
  }

  return blocks
}

export function connectionBlocks(model: SlackHomeViewModel): unknown[] {
  const fields: { type: 'mrkdwn'; text: string }[] = [
    { type: 'mrkdwn', text: `*Nuphos team*\n${escapeSlackMrkdwn(model.teamName)}` },
    { type: 'mrkdwn', text: `*Slack workspace*\n${escapeSlackMrkdwn(model.slackTeamName)}` },
    {
      type: 'mrkdwn',
      text: model.viewer
        ? `*Your Nuphos account*\n${escapeSlackMrkdwn(model.viewer.name)} (${escapeSlackMrkdwn(model.viewer.email)})`
        : '*Your Nuphos account*\n_Not linked_',
    },
  ]

  if (model.viewer?.role) {
    const role = model.viewer.role

    fields.push({
      type: 'mrkdwn',
      text: `*Team role*\n${role.charAt(0)}${role.slice(1).toLowerCase()}`,
    })
  }
  const blocks: unknown[] = [
    { type: 'section', text: { type: 'mrkdwn', text: '*🔗 Connection*' } },
    { type: 'section', fields },
  ]

  if (!model.viewer) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '_Accounts link automatically when your Slack email matches your Nuphos account email. Otherwise link manually in the Nuphos desktop app → Settings → Slack._',
        },
      ],
    })
  }

  return blocks
}

export function linkedChannelBlocks(model: SlackHomeViewModel): unknown[] {
  // Channel mappings are team-level config — the interaction handler enforces
  // the ADMINISTRATOR gate server-side (client payloads are forgeable), and
  // the picker is hidden here so non-admins aren't offered an action that
  // would only be denied.
  const canLinkChannels = model.viewer?.role === 'ADMINISTRATOR'
  const shown = model.linkedChannelIds.slice(0, MAX_LINKED_CHANNELS_SHOWN)
  const hidden = model.linkedChannelIds.length - shown.length
  const channelList =
    shown.length > 0
      ? shown.map((id) => `<#${id}>`).join('  ') + (hidden > 0 ? `  _+${String(hidden)} more_` : '')
      : canLinkChannels
        ? '_No channels linked yet — pick one below to get started._'
        : '_No channels linked yet — ask a team administrator to link one._'

  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*#️⃣ Linked channels*\n${channelList}` },
    },
    {
      type: 'actions',
      block_id: 'nuphos_home_actions',
      elements: [
        ...(canLinkChannels
          ? [
              {
                type: 'conversations_select',
                action_id: 'nuphos_link_channel',
                placeholder: { type: 'plain_text', text: 'Link a channel' },
                filter: { include: ['public', 'private'] },
              },
            ]
          : []),
        {
          type: 'button',
          action_id: HOME_REFRESH_ACTION,
          text: { type: 'plain_text', text: '🔄 Refresh', emoji: true },
        },
      ],
    },
    ...(canLinkChannels
      ? [
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: 'Private channels only work after you `/invite @Nuphos` there first.',
              },
            ],
          },
        ]
      : []),
  ]
}

export function howToUseBlocks(model: SlackHomeViewModel): unknown[] {
  const mention = model.botUserId ? `<@${model.botUserId}>` : '@Nuphos'
  const lines = [
    `• Mention ${mention} in a linked channel to start working in a thread — replies in that thread don't need another mention.`,
    '• Open the *Chat* tab above to talk 1:1; *History* lists your past conversations.',
    '• When a change needs sign-off, Nuphos posts a plan card — press *Approve* to let it execute.',
  ]

  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*📖 How to use*\n${lines.join('\n')}` },
    },
  ]
}

export const HOME_INTRO_BLOCKS: unknown[] = [
  {
    type: 'header',
    text: { type: 'plain_text', text: '👋 Welcome to Nuphos', emoji: true },
  },
  {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: 'Nuphos is your AI DevOps engineer. Ask about cluster health, alerts, deployments, and troubleshooting — it investigates with live thinking steps, proposes plans, and acts once you approve.',
    },
  },
]

export const HOME_FOOTER_BLOCK: unknown = {
  type: 'context',
  elements: [
    {
      type: 'mrkdwn',
      text: 'AI-generated answers may be inaccurate. Manage this connection in the Nuphos desktop app → Settings → Slack.',
    },
  ],
}
