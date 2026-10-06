// The `nuphos-tools` MCP surface: host-control tools that cannot be expressed
// as ordinary domain REST resources (memory, decisions, local Desktop actions,
// channel delivery, …), served to the Claude Code runtime per conversation.
import { previewToolModules } from './preview-tools'

import type { PreviewToolContext, PreviewToolModule } from './preview-tool-context'
import type { McpSurface, ToolHandler } from '@/lib/mcp/protocol'

export { toolModuleFromAiSdkTools } from './preview-tools/ai-sdk-adapter'

export const NUPHOS_TOOLS_INSTRUCTIONS =
  "Nuphos's native tools for this conversation: memory (save_memory / " +
  'memory_get), charts, team-skill authoring, decisions, local Desktop actions, ' +
  'connector setup (create_connector), thread delegation (create_thread / send_message_to_thread), and channel delivery. Domain resources use native skills backed by the ' +
  'canonical Nuphos REST API. Every call renders its own card in the Nuphos chat UI — ' +
  'do not re-describe the output in prose beyond what the user needs. Every ' +
  "tool takes a `label`: a 5-12 word summary of this call in the user's " +
  'language, shown as the step title. For save_memory, always pass `scope` ' +
  'explicitly: use `team` for shared infrastructure state or changes, ' +
  'operational decisions, and reusable findings; use `personal` only for ' +
  'user-specific preferences or context.'

export function nuphosToolsSurface(modules: readonly PreviewToolModule[]): McpSurface {
  return {
    serverName: 'nuphos-tools',
    instructions: NUPHOS_TOOLS_INSTRUCTIONS,
    toolDefinitions: modules.flatMap((module) => [...module.definitions]),
  }
}

export function mergeToolHandlers(
  modules: readonly PreviewToolModule[],
  ctx: PreviewToolContext,
): Record<string, ToolHandler> {
  const merged: Record<string, ToolHandler> = {}

  for (const module of modules) {
    for (const [name, handler] of Object.entries(module.handlers(ctx))) {
      if (name in merged) throw new Error(`Duplicate preview tool name: ${name}`)
      merged[name] = handler
    }
  }

  return merged
}

/** Surface + handlers for one conversation's `nuphos-tools` MCP request. */
export async function nuphosToolsMcp(
  ctx: PreviewToolContext,
): Promise<{ surface: McpSurface; tools: Record<string, ToolHandler> }> {
  const modules = await previewToolModules(ctx)

  return { surface: nuphosToolsSurface(modules), tools: mergeToolHandlers(modules, ctx) }
}
