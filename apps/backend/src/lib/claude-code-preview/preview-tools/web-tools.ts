import { z } from 'zod'

import { config } from '@/config'
import { keenableFetch, keenableSearch } from '@/lib/agent/web-tools/keenable'
import { toolError, toolResult } from '@/lib/mcp/protocol'

import { toolInputJsonSchema } from './ai-sdk-adapter'

import type { PreviewToolModule } from '../preview-tool-context'

export type WebToolConfig = {
  webSearchProvider?: string
  webFetchProvider?: string
  keenableApiKey?: string
}

const searchInput = z
  .object({
    query: z.string().trim().min(1).max(2000),
    max_results: z.number().int().min(1).max(50).optional(),
    site: z.string().trim().min(1).max(200).optional(),
    published_after: z.string().trim().min(1).max(40).optional(),
  })
  .strict()

const fetchInput = z
  .object({
    url: z.string().trim().url(),
    live: z.boolean().optional(),
    prompt: z.string().trim().min(1).max(2000).optional(),
    max_chars: z.number().int().min(1).optional(),
  })
  .strict()

function keenableOptions(agent: WebToolConfig, sessionId: string) {
  return {
    ...(agent.keenableApiKey ? { apiKey: agent.keenableApiKey } : {}),
    title: 'nuphos',
    sessionId,
  }
}

export function webToolModule(agent: WebToolConfig = config.agent): PreviewToolModule {
  const searchEnabled = agent.webSearchProvider === 'keenable'
  const fetchEnabled = agent.webFetchProvider === 'keenable'
  const definitions = [
    ...(searchEnabled
      ? [
          {
            name: 'web_search',
            description:
              'Search the web with Keenable. Returns ranked pages with title, URL and snippet. ' +
              'Use site or published_after to narrow results, then web_fetch to read a page.',
            inputSchema: toolInputJsonSchema(searchInput),
          },
        ]
      : []),
    ...(fetchEnabled
      ? [
          {
            name: 'web_fetch',
            description:
              'Fetch a web page as clean markdown with Keenable. Set live to read the current ' +
              'page instead of the index, or prompt to extract only the requested part.',
            inputSchema: toolInputJsonSchema(fetchInput),
          },
        ]
      : []),
  ]

  return {
    definitions,
    handlers: (ctx) => ({
      ...(searchEnabled
        ? {
            web_search: async (args) => {
              const parsed = searchInput.safeParse(args)

              if (!parsed.success) return toolError(parsed.error.message)
              try {
                return toolResult(
                  await keenableSearch(parsed.data, keenableOptions(agent, ctx.sessionId)),
                )
              } catch (error) {
                return toolError(error instanceof Error ? error.message : 'Keenable search failed')
              }
            },
          }
        : {}),
      ...(fetchEnabled
        ? {
            web_fetch: async (args) => {
              const parsed = fetchInput.safeParse(args)

              if (!parsed.success) return toolError(parsed.error.message)
              try {
                return toolResult(
                  await keenableFetch(parsed.data, keenableOptions(agent, ctx.sessionId)),
                )
              } catch (error) {
                return toolError(error instanceof Error ? error.message : 'Keenable fetch failed')
              }
            },
          }
        : {}),
    }),
  }
}
