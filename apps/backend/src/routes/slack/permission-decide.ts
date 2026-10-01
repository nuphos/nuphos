import { createInteractionRepliers } from '@/routes/slack/interaction-replies'

/** Old Slack cards must never apply IAM changes after the workflow is retired. */
export async function handlePermissionGrantInteraction(args: {
  slackWorkspaceId: string
  slackUserId: string
  decision: 'approve' | 'reject'
  value: string
  responseUrl?: string
  channelId?: string
  threadTs?: string
}): Promise<void> {
  const { reject } = createInteractionRepliers({
    ...args,
    rejectLogExtra: { decision: args.decision },
    events: {
      noResponseUrl: 'slack.permission.decide.no_response_url',
      responseUrlError: 'slack.permission.decide.response_url_error',
      rejected: 'slack.permission.decide_rejected',
      ephemeralError: 'slack.permission.decide.ephemeral_error',
    },
  })

  await reject(
    'permission_workflow_retired',
    'This permission proposal can no longer be applied. Update the connector permissions in your cloud console, or ask the agent to use local_exec on a device already signed in with the required CLI permissions.',
  )
}
