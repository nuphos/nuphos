import { tool } from 'ai'
import { z } from 'zod'

import { logEvent } from '@/lib/observability'
import { listIncidentOccurrences } from '@/lib/slack/incident-occurrences'

import { labelField } from './labeling'

import type { createLarkOutboundContext } from '@/lib/lark/agent-outbound'
import type { createSlackOutboundContext } from '@/lib/slack/agent-outbound'
import type { SlackTriggerNotificationContext } from '@/lib/slack/incident-notifications'

type NotificationToolDeps = {
  conversationId: string
  teamId?: string | null
  slackOutbound: Awaited<ReturnType<typeof createSlackOutboundContext>> | null
  larkOutbound: Awaited<ReturnType<typeof createLarkOutboundContext>> | null
  triggerNotification?: SlackTriggerNotificationContext
  incidentContextGathered: Set<string>
}

export function createNotificationTools(deps: NotificationToolDeps): {
  slackNotificationTools: Record<string, unknown>
  larkNotificationTools: Record<string, unknown>
} {
  const { conversationId, teamId, slackOutbound, larkOutbound, triggerNotification } = deps

  /**
   * The whole design assumes the agent looks before it decides, and nothing
   * forces it to. A regression there is invisible in the output — the alert
   * still gets posted, just into a thread nobody wanted — so the cases where
   * history existed and was never read are recorded.
   */
  const reportIncidentContextSkipped = async (continuedThread: boolean): Promise<void> => {
    if (!triggerNotification || !teamId) return
    if (continuedThread || deps.incidentContextGathered.has('incident_history')) return
    try {
      const prior = await listIncidentOccurrences({
        teamId,
        triggerId: triggerNotification.triggerId,
        incidentScope: triggerNotification.incidentScope,
        since: new Date(Date.now() - 24 * 60 * 60_000),
        limit: 1,
      })

      if (prior.length === 0) return
      logEvent('warn', 'agent.incident.opened_thread_without_reading_history', {
        team_id: teamId,
        trigger_id: triggerNotification.triggerId,
        conversation_id: conversationId,
        read_channel: deps.incidentContextGathered.has('slack_read_channel'),
      })
    } catch {
      // Telemetry only; never let it affect a delivered notification.
    }
  }

  const slackNotConnected = () => ({
    ok: false as const,
    errorCode: 'slack_not_connected' as const,
    error:
      'Slack is not connected to this Nuphos team. Ask the user to connect the Nuphos Slack App, then continue this same managed workflow. Do not request or recommend a Slack Incoming Webhook, AWS Chatbot, or another provider-native Slack integration unless the user explicitly asked for that architecture.',
    requiredNextAction: 'Connect the Nuphos Slack App to this team.',
  })
  const slackNotificationTools: Record<string, unknown> = {
    slack_list_destinations: tool({
      description:
        'List the Slack destinations this Nuphos team can actually use for proactive notifications. This capability is always present so an unconnected team returns the structured slack_not_connected blocker instead of looking unsupported. ' +
        'Channels are limited to channels the installed bot has joined, plus channels in other workspaces explicitly linked to this team; every entry carries its slackWorkspaceId/slackWorkspaceName. dmSelfAvailable says whether the current user linked their Slack identity (DMs need the team’s own installation). ' +
        'Use this before creating a trigger that names Slack, and whenever the user asks to send to Slack without providing a stable channel ID. ' +
        'If it returns slack_not_connected, ask the user to connect the Nuphos Slack App and preserve the intended provider → Nuphos Trigger → Slack plan. Do not fall back to Slack Incoming Webhooks or provider-native Slack integrations unless the user explicitly requests them. ' +
        'Present the real choices to the user and never guess a channel.',
      inputSchema: z.object({ label: labelField }),
      execute: async () => {
        if (!slackOutbound) return slackNotConnected()
        try {
          return await slackOutbound.listDestinations()
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      },
    }),
    slack_post: tool({
      description:
        'Send a message to Slack through the first-party Nuphos Slack App, to an explicitly user-approved destination. This capability stays visible when Slack is unconnected and then returns slack_not_connected; never replace it with a Slack Incoming Webhook or a provider-native Slack integration unless the user explicitly asks. ' +
        'For a channel, use only a channelId returned by slack_list_destinations; a trigger-fired run is locked to the destination stored when the user approved the Watch, and the delivery policy names it. Never choose a channel yourself. ' +
        'Set bindConversation=true for trigger/desktop notifications so replies continue this exact Nuphos conversation. ' +
        'For a report or summary nobody is waiting on — a scheduled digest, a cost breakdown — pass replyThread instead: the root stays scannable, the detail goes in the thread, and follow-ups there are answered in a conversation of their own. Without it a reply in that thread reaches nobody. ' +
        'Pass replyToThread with a threadTs to continue an existing thread — use one from incident_history when this alert is the same problem still going or coming back. Omit it to start a new thread. That placement is the whole decision: there is no message type to declare and nothing to classify. ' +
        'On a monitoring alert, say something quickly so whoever is watching knows it is being looked at, then investigate and follow up in the same thread. Judge what is worth sending the way an on-call engineer who respects their team would: the server will not make that judgment for you, it only refuses a byte-identical repeat, a thread that is not this alert’s, and a second delivery racing the first. ' +
        'This is an external side effect. If a post fails, report the error and do not retry it unchanged in the same turn.',
      inputSchema: z.object({
        label: labelField,
        destination: z.discriminatedUnion('type', [
          z.object({
            type: z.literal('channel'),
            channelId: z
              .string()
              .min(1)
              .max(32)
              .describe('Stable Slack channel ID returned by slack_list_destinations.'),
            slackWorkspaceId: z
              .string()
              .min(1)
              .max(32)
              .optional()
              .describe(
                'The slackWorkspaceId shown on the chosen slack_list_destinations entry. Pass it whenever the listing spans more than one workspace.',
              ),
          }),
          z.object({ type: z.literal('dm_self') }),
        ]),
        text: z
          .string()
          .trim()
          .min(1)
          .max(12_000)
          .describe('Concise Slack-ready alert, investigation result, update, or recovery.'),
        bindConversation: z
          .boolean()
          .default(true)
          .describe('Bind replies on this Slack root to the current Nuphos conversation.'),
        replyToThread: z
          .string()
          .optional()
          .describe(
            'Slack threadTs to reply in, from incident_history. Omit to start a new thread.',
          ),
        replyThread: z
          .object({
            text: z
              .string()
              .trim()
              .min(1)
              .max(12_000)
              .describe(
                'The first message in the thread under the root. Put the detail here — findings, tables, per-item breakdowns — and keep the root to what someone scanning the channel needs.',
              ),
          })
          .optional()
          .describe(
            'Opens a replyable thread under the new root and gives it its own Nuphos conversation, so anyone in the channel can ask a follow-up about this message and be answered with it in hand. Use it for a report or summary nobody is waiting on in a live conversation. Cannot be combined with replyToThread, and a monitoring alert does not need it — its thread is already replyable.',
          ),
      }),
      execute: async (input) => {
        if (!slackOutbound) return slackNotConnected()
        const {
          label: _label,
          destination,
          text,
          bindConversation,
          replyToThread,
          replyThread,
        } = input
        const result = await slackOutbound.post({
          destination,
          text,
          bindConversation,
          ...(replyToThread ? { replyToThread } : {}),
          ...(replyThread ? { replyThread } : {}),
        })

        await reportIncidentContextSkipped(Boolean(replyToThread))

        return result
      },
    }),
  }

  const larkNotConnected = () => ({
    ok: false as const,
    errorCode: 'lark_not_connected' as const,
    error:
      'Lark (Feishu) is not connected to this Nuphos team. Ask the user to connect their Lark custom app in the desktop app (Connectors → Lark), then continue this same workflow.',
    requiredNextAction: 'Connect a Lark custom app to this team.',
  })
  const larkNotificationTools: Record<string, unknown> = {
    lark_list_destinations: tool({
      description:
        'List the Lark (Feishu) groups this Nuphos team can post to. Groups are limited to the ones the connected bot is actually a member of. ' +
        'Call this before lark_post whenever the user asks to send something to a Lark/Feishu group, so you can present the real choices and get a stable chatId. ' +
        'If it returns lark_not_connected, ask the user to connect their Lark custom app in Connectors → Lark. Never guess a chatId.',
      inputSchema: z.object({ label: labelField }),
      execute: async () => {
        if (!larkOutbound) return larkNotConnected()
        try {
          return await larkOutbound.listDestinations()
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      },
    }),
    lark_post: tool({
      description:
        'Proactively send a message to a Lark (Feishu) group through the team’s connected custom app. ' +
        'Use only a chatId returned by lark_list_destinations — never a group name and never a guessed id. ' +
        'This is an external side effect: send at most one message per user request unless the user explicitly asked for more. If it fails, report the error and do not retry in the same turn.',
      inputSchema: z.object({
        label: labelField,
        chatId: z
          .string()
          .trim()
          .min(1)
          .max(64)
          .describe('Stable Lark chat_id (starts with oc_) returned by lark_list_destinations.'),
        text: z
          .string()
          .trim()
          .min(1)
          .max(12_000)
          .describe('The message to post to the Lark group. Plain text (Lark renders newlines).'),
      }),
      execute: async (input) => {
        if (!larkOutbound) return larkNotConnected()

        return await larkOutbound.post({ chatId: input.chatId, text: input.text })
      },
    }),
  }

  return { slackNotificationTools, larkNotificationTools }
}
