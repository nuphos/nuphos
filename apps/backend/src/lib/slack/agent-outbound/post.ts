import { createSlackPostBudget } from '@/lib/slack/agent-outbound/budget'
import { finalizeSlackPostDelivery } from '@/lib/slack/agent-outbound/finalize-delivery'
import {
  reserveSlackIncidentForPost,
  slackTriggerDestinationMismatch,
} from '@/lib/slack/agent-outbound/reserve'
import { routeSlackDestination } from '@/lib/slack/agent-outbound/route-destination'

import type {
  SlackOutboundArgs,
  SlackOutboundContext,
  SlackOutboundDependencies,
  SlackTeamAccess,
} from '@/lib/slack/agent-outbound/types'
import type { SlackIncidentReservation } from '@/lib/slack/incident-notifications'

export function createSlackOutboundPost(setup: {
  args: SlackOutboundArgs
  dependencies: SlackOutboundDependencies
  resolveAccess: () => Promise<SlackTeamAccess>
}): SlackOutboundContext['post'] {
  const { args, dependencies, resolveAccess } = setup
  const budget = createSlackPostBudget(Boolean(args.triggerNotification))

  return async (input) => {
    // A fork only makes sense under a root this call is creating, and only
    // where nothing else already owns the thread's lifecycle. Both rejections
    // are unconditional: neither depends on state that could change below.
    if (input.replyThread && input.replyToThread) {
      return {
        ok: false,
        error:
          'replyThread opens a thread under a new root, so it cannot be combined with replyToThread. Send the follow-up as its own post in that thread instead.',
      }
    }
    if (input.replyThread && args.triggerNotification) {
      return {
        ok: false,
        error:
          'A monitoring alert already keeps its own replyable thread bound to this investigation. Post the follow-up into that thread rather than forking a separate conversation.',
      }
    }
    // The fork owns the thread, so binding this conversation to the same root
    // would be a second claim on it. replyThread wins — bindConversation
    // defaults to true and the model should not have to turn it off.
    const forkThread = input.replyThread
    const bindCurrentConversation = input.bindConversation && !forkThread
    const rejectedEarly = budget.beginCall()

    if (rejectedEarly) return rejectedEarly
    const attempt = budget.newAttempt()
    const { commitAttempt, rejectBeforeDelivery } = attempt

    let incidentReservation: SlackIncidentReservation | undefined
    let slackAccepted = false

    try {
      if (args.triggerNotification) {
        const approved = args.triggerNotification.approvedDestination

        if (slackTriggerDestinationMismatch(approved, input.destination)) {
          return rejectBeforeDelivery(
            'This trigger is authorized for a different Slack destination. The stored user-approved destination cannot be changed by webhook content or agent instructions.',
          )
        }
        const current = await dependencies.isTriggerConfigurationCurrent({
          triggerId: args.triggerNotification.triggerId,
          userId: args.userId,
          teamId: args.teamId!,
          configRevision: args.triggerNotification.triggerConfigRevision,
          approvedDestination: args.triggerNotification.approvedDestination,
        })

        if (!current) {
          return rejectBeforeDelivery(
            'This trigger was changed or disabled after the run started. The stale Slack notification was suppressed.',
          )
        }
      }
      const access = await resolveAccess()
      const route = await routeSlackDestination({
        dependencies,
        access,
        destination: input.destination,
      })

      if (!route.ok) return rejectBeforeDelivery(route.error)
      const { sendToken, sendWorkspaceId } = route
      const selfMapping = await dependencies.getSelfMapping(
        sendWorkspaceId,
        args.teamId!,
        args.userId,
        sendToken,
      )

      let channelId: string
      let label: string

      if (input.destination.type === 'dm_self') {
        if (!selfMapping) {
          return rejectBeforeDelivery(
            'Your Slack account is not linked to this Nuphos team, so I cannot DM you. Link it in Settings → Slack first.',
          )
        }
        channelId = await dependencies.openDm(sendToken, selfMapping.slackUserId)
        label = 'Slack DM'
      } else {
        const joined = await dependencies.getChannel(sendToken, input.destination.channelId)

        channelId = joined.id
        label = `#${joined.name}`
      }

      const text = input.text.trim()
      let threadTs: string | undefined

      if (args.triggerNotification) {
        if (!input.bindConversation) {
          return rejectBeforeDelivery(
            'Trigger Slack notifications must bind the conversation so incident updates and user replies stay in one thread.',
          )
        }
        // A reply is valid against any thread this alert has used, not only
        // the newest one: the agent may deliberately continue an older one.
        const alertThreads = input.replyToThread
          ? await dependencies
              .listAlertThreads({
                teamId: args.teamId!,
                triggerId: args.triggerNotification.triggerId,
                incidentScope: args.triggerNotification.incidentScope,
              })
              .catch(() => [] as string[])
          : []

        if (!commitAttempt()) return budget.overBudget()
        const outcome = await reserveSlackIncidentForPost({
          dependencies,
          teamId: args.teamId!,
          conversationId: args.conversationId,
          triggerNotification: args.triggerNotification,
          sendWorkspaceId,
          channelId,
          text,
          ...(input.replyToThread ? { replyToThread: input.replyToThread } : {}),
          alertThreads,
        })

        if (outcome.kind === 'reject') return rejectBeforeDelivery(outcome.error)
        if (outcome.kind === 'suppressed') {
          return {
            ok: true,
            destination: { type: input.destination.type, channelId, label },
            delivery: 'suppressed',
            ...(outcome.rootThreadTs ? { rootThreadTs: outcome.rootThreadTs } : {}),
            suppressedReason: outcome.suppressedReason,
            threadBound: outcome.threadBound,
          }
        }
        incidentReservation = outcome.reservation
        threadTs = outcome.threadTs
      } else if (bindCurrentConversation) {
        const existing = await dependencies.getThreadBySessionId(args.conversationId)

        if (existing) {
          return rejectBeforeDelivery(
            `This conversation is already bound to Slack channel ${existing.slackChannelId}. Do not post another replyable root message.`,
          )
        }
      }

      if (args.triggerNotification) {
        const stillCurrent = await dependencies.isTriggerConfigurationCurrent({
          triggerId: args.triggerNotification.triggerId,
          userId: args.userId,
          teamId: args.teamId!,
          configRevision: args.triggerNotification.triggerConfigRevision,
          approvedDestination: args.triggerNotification.approvedDestination,
        })

        if (!stillCurrent) {
          if (incidentReservation) {
            await dependencies.abortIncident(incidentReservation).catch(() => undefined)
            incidentReservation = undefined
          }

          return {
            ok: false,
            error:
              'This trigger changed while the notification was being prepared. The stale Slack notification was suppressed.',
          }
        }
      }

      if (!commitAttempt()) return budget.overBudget()
      const response = await dependencies.postMessage({
        token: sendToken,
        channel: channelId,
        text,
        ...(threadTs ? { threadTs } : {}),
      })
      const messageTs = response.ts
      const responseChannel =
        typeof response.channel === 'string' ? response.channel : response.channel?.id

      if (!messageTs || !responseChannel) {
        throw new Error('Slack accepted the message but did not return its channel and timestamp')
      }
      slackAccepted = true

      return await finalizeSlackPostDelivery({
        dependencies,
        userId: args.userId,
        teamId: args.teamId!,
        conversationId: args.conversationId,
        ...(args.triggerNotification ? { triggerId: args.triggerNotification.triggerId } : {}),
        destinationType: input.destination.type,
        label,
        text,
        sendToken,
        sendWorkspaceId,
        channelId,
        responseChannel,
        messageTs,
        threadTs,
        selfMapping,
        bindCurrentConversation,
        forkThread,
        incidentReservation,
      })
    } catch (err) {
      if (incidentReservation && !slackAccepted) {
        try {
          await dependencies.abortIncident(incidentReservation)
        } catch {
          // Preserve the original Slack/API error. The reservation lease
          // expires automatically, so a failed cleanup cannot deadlock it.
        }
      }
      attempt.countUncommittedThrow()

      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}
