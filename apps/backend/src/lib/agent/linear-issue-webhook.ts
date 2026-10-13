import { z } from 'zod'

import { agentConversations } from './db'

const linearIssueEvent = z.object({
  type: z.literal('Issue'),
  data: z.object({
    id: z.string().uuid(),
    identifier: z.string(),
    title: z.string(),
    state: z.object({ name: z.string(), type: z.string() }),
  }),
})

/** Keep linked Linear tags in step with the issue, as the GitHub webhook does for PRs. */
export async function applyLinearIssueWebhook(payload: unknown) {
  const parsed = linearIssueEvent.safeParse(payload)

  if (!parsed.success) return
  const { id, identifier, title, state } = parsed.data.data
  // Issue ids are global UUIDs; the key prefix keeps this on the linkedResources.key index.
  const key = { $regex: `^linear/[a-f\\d]{24}/${id}$` }

  await agentConversations().updateMany(
    { 'linkedResources.key': key },
    {
      $set: {
        'linkedResources.$[resource].title': `${identifier} ${title}`.slice(0, 300),
        'linkedResources.$[resource].state': state.name,
        'linkedResources.$[resource].stateType': state.type,
      },
    },
    { arrayFilters: [{ 'resource.key': key }] },
  )
}
