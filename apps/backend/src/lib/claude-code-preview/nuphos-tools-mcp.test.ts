import { describe, expect, test } from 'bun:test'

import { toolResult } from '@/lib/mcp/protocol'

import {
  mergeToolHandlers,
  NUPHOS_TOOLS_INSTRUCTIONS,
  nuphosToolsSurface,
  toolsHash,
} from './nuphos-tools-mcp'

import type { PreviewToolContext, PreviewToolModule } from './preview-tool-context'

const ctx: PreviewToolContext = { userId: 'u', teamId: 't', sessionId: 's', locale: 'en' }

function module(names: string[]): PreviewToolModule {
  return {
    definitions: names.map((name) => ({ name, description: name, inputSchema: {} })),
    handlers: () =>
      Object.fromEntries(names.map((name) => [name, async () => toolResult({ name })])),
  }
}

describe('nuphos-tools surface', () => {
  test('advertises every module definition under the nuphos-tools server', () => {
    const surface = nuphosToolsSurface([module(['save_memory']), module(['render_chart'])])

    expect(surface.serverName).toBe('nuphos-tools')
    expect(surface.toolDefinitions.map((d) => (d as { name: string }).name)).toEqual([
      'save_memory',
      'render_chart',
    ])
  })

  test('tells Claude to choose memory scope explicitly', () => {
    expect(NUPHOS_TOOLS_INSTRUCTIONS).toContain('always pass `scope` explicitly')
    expect(NUPHOS_TOOLS_INSTRUCTIONS).toContain('use `team` for shared infrastructure')
    expect(NUPHOS_TOOLS_INSTRUCTIONS).toContain('use `personal` only for user-specific')
  })

  test('routes sub-agent requests to create_thread', () => {
    expect(NUPHOS_TOOLS_INSTRUCTIONS).toContain('use create_thread, not your')
    expect(NUPHOS_TOOLS_INSTRUCTIONS).toContain('list_recent_conversations children:true')
  })

  test('routes domain resources away from the host-control MCP surface', () => {
    expect(NUPHOS_TOOLS_INSTRUCTIONS).toContain('canonical Nuphos REST API')
    expect(NUPHOS_TOOLS_INSTRUCTIONS).not.toContain('cost dashboards and panels')
    expect(NUPHOS_TOOLS_INSTRUCTIONS).not.toContain('read-only database access')
  })

  test('merges handlers and refuses duplicate tool names', async () => {
    const merged = mergeToolHandlers([module(['a']), module(['b'])], ctx)

    expect(Object.keys(merged).sort((x, y) => x.localeCompare(y))).toEqual(['a', 'b'])
    expect((await merged.a!({})).structuredContent).toEqual({ name: 'a' })
    expect(() => mergeToolHandlers([module(['a']), module(['a'])], ctx)).toThrow(
      'Duplicate preview tool name: a',
    )
  })
})

describe('the tools version', () => {
  const tool = (properties: Record<string, unknown>, description = 'Start a sub-agent.') => ({
    name: 'create_thread',
    description,
    inputSchema: { type: 'object', properties },
  })

  test('changes when an existing tool gains a parameter, so idle agents respawn', () => {
    expect(toolsHash([tool({ model: {} })])).not.toBe(
      toolsHash([tool({ model: {}, runtimeId: {} })]),
    )
  })

  test('changes when a tool stops being deferred, so idle agents load it', () => {
    expect(toolsHash([tool({ model: {} })])).not.toBe(
      toolsHash([{ ...tool({ model: {} }), _meta: { 'anthropic/alwaysLoad': true } }]),
    )
  })

  test('ignores descriptions, which carry per-turn data', () => {
    expect(toolsHash([tool({ model: {} }, 'Today is Monday.')])).toBe(
      toolsHash([tool({ model: {} }, 'Today is Tuesday.')]),
    )
  })
})
