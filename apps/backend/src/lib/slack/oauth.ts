import { config } from '@/config'

const SLACK_AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize'
const SLACK_TOKEN_URL = 'https://slack.com/api/oauth.v2.access'

export const SLACK_BOT_SCOPES = [
  'app_mentions:read',
  // Marks the app as a Slack agent so streamed "thinking steps" (chat.startStream
  // task cards) render as intended. Requires the "Agents & AI Apps" feature to be
  // enabled in the app config FIRST (that is what makes this scope requestable),
  // and every workspace must re-install for it to take effect on the bot token.
  'assistant:write',
  'channels:history',
  'channels:read',
  'chat:write',
  // Slash commands (`/nuphos pickup` — continue a desktop conversation from
  // Slack). Adding it requires every workspace to re-install; until then the
  // command simply does not appear in the workspace.
  'commands',
  // Attaching agent-produced files (transfer-store downloads) to the thread
  // via files.getUploadURLExternal / files.completeUploadExternal. Adding it
  // requires every workspace to re-install; until then attachments degrade to
  // a "download it in Nuphos" message (lib/slack/files.ts).
  'files:write',
  // Reading attachments the user posts (url_private downloads), so a screenshot
  // dropped into a thread reaches the agent instead of being dropped along with
  // the message carrying it. Adding it requires every workspace to re-install;
  // until then inbound attachments degrade to a note that the file could not be
  // read (lib/agent/inbound-files.ts).
  'files:read',
  'groups:history',
  'groups:read',
  'im:history',
  'im:write',
  // Lets the bot react to the user's message (👀 on receipt, ✅/🎉 on
  // completion). Adding it requires every workspace to re-install.
  'reactions:write',
  // assistant.search.context — the agent's slack_search workspace-retrieval
  // tool — needs the search:read.* scopes below. They are still pending Slack
  // review, so we do NOT request them yet (an unapproved scope in the OAuth
  // authorize URL is rejected). slack_search stays disabled in the meantime
  // (see SLACK_SEARCH_ENABLED in routes/slack.ts). Re-add these once approved:
  //   'search:read.files',
  //   'search:read.public',
  //   'search:read.users',
  // users.info (the email auto-mapping lookup) requires users:read;
  // users:read.email only unlocks the profile.email field on top of it.
  'users:read',
  'users:read.email',
].join(',')

export type SlackOAuthTokens = {
  botToken: string
  botUserId: string
  scope: string
  slackTeamId: string
  slackTeamName: string
  installerSlackUserId: string | null
}

export function getDefaultClientCredentials(): { clientId: string; clientSecret: string } | null {
  const { clientId, clientSecret } = config.slack.oauth

  if (!clientId || !clientSecret) return null

  return { clientId, clientSecret }
}

export function getSetupRedirect(): string | null {
  return config.slack.oauth.setupRedirect ?? null
}

export function isSlackOAuthConfigured(): boolean {
  return Boolean(
    config.slack.oauth.clientId &&
    config.slack.oauth.clientSecret &&
    config.slack.oauth.setupRedirect &&
    config.slack.oauth.encryptionKey,
  )
}

export function buildAuthorizeUrl(input: {
  clientId: string
  redirectUri: string
  state: string
  // Slack workspace id to pre-select in the authorize picker. Set on reinstall
  // to steer re-approval to the workspace already bound to this team.
  team?: string | null
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    scope: SLACK_BOT_SCOPES,
    redirect_uri: input.redirectUri,
    state: input.state,
  })

  if (input.team) params.set('team', input.team)

  return `${SLACK_AUTHORIZE_URL}?${params.toString()}`
}

export async function exchangeCodeForTokens(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<SlackOAuthTokens> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  })
  const response = await fetch(SLACK_TOKEN_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = (await response.json()) as {
    ok: boolean
    error?: string
    access_token?: string
    scope?: string
    bot_user_id?: string
    team?: { id?: string; name?: string }
    authed_user?: { id?: string }
  }

  if (!response.ok || !json.ok || !json.access_token || !json.bot_user_id || !json.team?.id) {
    throw new Error(json.error ?? 'Slack OAuth token exchange failed')
  }

  return {
    botToken: json.access_token,
    botUserId: json.bot_user_id,
    scope: json.scope ?? SLACK_BOT_SCOPES,
    slackTeamId: json.team.id,
    slackTeamName: json.team.name ?? json.team.id,
    installerSlackUserId: json.authed_user?.id ?? null,
  }
}
