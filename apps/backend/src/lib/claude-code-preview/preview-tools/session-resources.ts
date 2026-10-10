import { z } from 'zod'

import {
  bindSessionResource,
  resourceConversation,
  sessionResourceInput,
  unlinkSessionResource,
} from '@/lib/agent/session-resources'
import { toolError, toolResult } from '@/lib/mcp/protocol'

import { toolInputJsonSchema } from './ai-sdk-adapter'

import type { PreviewToolModule } from '../preview-tool-context'

const label = z.string().trim().min(1).max(200)
const bind = z.object({ label, resource: sessionResourceInput }).strict()
const list = z.object({ label }).strict()
const unlink = z.object({ label, resourceId: z.string().uuid() }).strict()

export function sessionResourceToolModule(): PreviewToolModule {
  return {
    definitions: [
      {
        name: 'bind_session_resource',
        description:
          'Link a GitHub PR or Linear issue to this conversation after creating or adopting it. The backend verifies the resource through a selected integration. GitHub PR events automatically wake this same conversation with its existing permissions; archived conversations do not wake. Linear issues are linked for navigation only. Idempotent for the same resource. Only the conversation owner or a manager can bind.',
        inputSchema: toolInputJsonSchema(bind),
      },
      {
        name: 'list_session_resources',
        description: 'List the external resources linked to this conversation.',
        inputSchema: toolInputJsonSchema(list),
      },
      {
        name: 'unlink_session_resource',
        description:
          'Remove a resource link from this conversation and stop future event wakeups. Does not change or delete the external resource.',
        inputSchema: toolInputJsonSchema(unlink),
      },
    ],
    handlers: (ctx) => ({
      bind_session_resource: async (args) => {
        const parsed = bind.safeParse(args)

        if (!parsed.success) return toolError(parsed.error.message)

        return toolResult(await bindSessionResource(ctx, parsed.data.resource))
      },
      list_session_resources: async (args) => {
        const parsed = list.safeParse(args)

        if (!parsed.success) return toolError(parsed.error.message)

        return toolResult({ resources: (await resourceConversation(ctx)).linkedResources ?? [] })
      },
      unlink_session_resource: async (args) => {
        const parsed = unlink.safeParse(args)

        if (!parsed.success) return toolError(parsed.error.message)

        return toolResult(await unlinkSessionResource(ctx, parsed.data.resourceId))
      },
    }),
  }
}
