import { tool } from 'ai'
import { z } from 'zod'

import { labelField } from './labeling'

import type { SlackReplyToolContext } from './types'

export function createSlackMessagingTools(
  slackReply?: SlackReplyToolContext,
): Record<string, unknown> {
  const slackTools: Record<string, unknown> = {}

  if (slackReply?.react) {
    const react = slackReply.react

    slackTools.slack_react = tool({
      description:
        'Add or remove an emoji reaction on the Slack message that started this turn. ' +
        'React like a human would to signal state: a 👀 (`eyes`) reaction is added automatically when you start, so use this to add a completion reaction ' +
        'such as `white_check_mark`, `tada`, or `partying_face` once the request is fully resolved (or `warning` / `x` if it failed or is blocked). ' +
        'You decide which emoji fits. Use Slack emoji short names without colons.',
      inputSchema: z.object({
        label: labelField,
        action: z.enum(['add', 'remove']).describe('Add or remove the reaction.'),
        name: z
          .string()
          .min(1)
          .max(100)
          .describe(
            'Slack emoji short name without colons, e.g. eyes, white_check_mark, tada, partying_face, warning.',
          ),
      }),
      execute: async (input) => {
        const { label: _label, action, name } = input

        return await react({ action, name })
      },
    })
  }
  if (slackReply?.search) {
    const search = slackReply.search

    slackTools.slack_search = tool({
      description:
        'Search the connected Slack workspace for messages relevant to a query (Slack assistant.search.context). ' +
        'Use it when the answer lives in Slack conversations themselves: "what did we decide about X", "summarize the recent discussion", incident chatter, past decisions. ' +
        'Results are relevance-ranked snippets with permalinks — cite the useful ones in your reply using Slack link syntax <permalink|short label>. ' +
        'If it reports search as unavailable, answer from your other tools and do not retry.',
      inputSchema: z.object({
        label: labelField,
        query: z.string().min(1).max(500).describe('Natural-language search query.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe('Max results to return (default 10, Slack caps at 20).'),
      }),
      execute: async (input) => {
        const { label: _label, query, limit } = input

        return await search({ query, limit })
      },
    })
  }

  return slackTools
}
