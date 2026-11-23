import { z } from 'zod'

import {
  bindSessionResource,
  resourceConversation,
  sessionResourceInput,
  unlinkSessionResource,
} from '@/lib/agent/session-resources'
import { sessionResources } from '@/lib/agent/session-thread-resources'
import { AppError } from '@/lib/errors'
import { toolError, toolResult } from '@/lib/mcp/protocol'

import { toolInputJsonSchema } from './ai-sdk-adapter'

import type { PreviewToolModule } from '../preview-tool-context'

const label = z.string().trim().min(1).max(200)
const bind = z.object({ label, resource: sessionResourceInput }).strict()
const list = z.object({ label }).strict()
const unlink = z.object({ label, resourceId: z.string().trim().min(1).max(300) }).strict()

// A refusal such as a GitHub rate limit is the answer the agent needs, so it gets
// the reason instead of the dispatcher's bare "Internal error". Other failures
// stay generic: their messages can carry internal details.
function answer(work: Promise<unknown>) {
  return work.then(toolResult, (error: unknown) => {
    if (error instanceof AppError) return toolError(error.message)
    throw error
  })
}

export function sessionResourceToolModule(): PreviewToolModule {
  return {
    definitions: [
      {
        name: 'bind_session_resource',
        description:
          'Link a GitHub PR or issue, GitLab merge request or Linear issue to this conversation after creating or adopting it. The backend verifies the resource through a selected integration. GitHub PR events, a GitHub issue being assigned, closed or reopened, and new comments on it from people who can push to its repository, automatically wake this same conversation with its existing permissions, and restore it if archived. GitLab merge requests and Linear issues are linked for navigation only; their state is rechecked while the conversation is open. Linking the same resource again keeps one link and refreshes its title and state. Only the conversation owner or a manager can bind.',
        inputSchema: toolInputJsonSchema(bind),
      },
      {
        name: 'list_session_resources',
        description:
          'List the external resources linked to this conversation, including its Slack or Discord thread.',
        inputSchema: toolInputJsonSchema(list),
      },
      {
        name: 'unlink_session_resource',
        description:
          'Remove a resource link from this conversation and stop future event wakeups. Unlinking its Slack or Discord thread also stops the conversation posting there; a new mention in that thread starts a new conversation. Does not change or delete the external resource.',
        inputSchema: toolInputJsonSchema(unlink),
      },
    ],
    handlers: (ctx) => ({
      bind_session_resource: async (args) => {
        const parsed = bind.safeParse(args)

        if (!parsed.success) return toolError(parsed.error.message)

        return answer(bindSessionResource(ctx, parsed.data.resource))
      },
      list_session_resources: async (args) => {
        const parsed = list.safeParse(args)

        if (!parsed.success) return toolError(parsed.error.message)

        return answer(
          resourceConversation(ctx).then(async (conversation) => ({
            resources: await sessionResources(conversation),
          })),
        )
      },
      unlink_session_resource: async (args) => {
        const parsed = unlink.safeParse(args)

        if (!parsed.success) return toolError(parsed.error.message)

        return answer(unlinkSessionResource(ctx, parsed.data.resourceId))
      },
    }),
  }
}
