import { upsertSlackUserMapping } from '@/lib/slack/agent-bot'
import { openSlackDm, postSlackMessage } from '@/lib/slack/api'
import { SLACK_SETTINGS_HINT } from '@/lib/slack/home-tab/blocks'

export async function autoLinkInstaller(args: {
  slackWorkspaceId: string
  teamId: string
  installerSlackUserId: string | null
  requesterNuphosUserId: string
}): Promise<void> {
  if (!args.installerSlackUserId) return
  await upsertSlackUserMapping({
    slackWorkspaceId: args.slackWorkspaceId,
    slackUserId: args.installerSlackUserId,
    teamId: args.teamId,
    nuphosUserId: args.requesterNuphosUserId,
    createdBy: args.requesterNuphosUserId,
    enabled: true,
  })
}

export async function sendSlackInstallWelcomeDm(args: {
  botToken: string
  installerSlackUserId: string
  slackTeamName: string
}): Promise<void> {
  const dmChannelId = await openSlackDm(args.botToken, args.installerSlackUserId)

  await postSlackMessage({
    token: args.botToken,
    channel: dmChannelId,
    text: `Nuphos is connected to ${args.slackTeamName}. ${SLACK_SETTINGS_HINT}`,
  })
}
