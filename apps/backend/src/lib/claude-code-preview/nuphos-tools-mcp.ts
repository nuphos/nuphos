// The `nuphos-tools` MCP surface: host-control tools that cannot be expressed
// as ordinary domain REST resources (memory, decisions, local Desktop actions,
// channel delivery, …), served to the Claude Code runtime per conversation.
import { previewToolModules } from './preview-tools'

import type { PreviewToolContext, PreviewToolModule } from './preview-tool-context'
import type { McpSurface, ToolHandler } from '@/lib/mcp/protocol'

export { toolModuleFromAiSdkTools } from './preview-tools/ai-sdk-adapter'

export const NUPHOS_TOOLS_INSTRUCTIONS =
  "Nuphos's native tools for this conversation: memory (save_memory / " +
  'memory_get), charts, artifacts, team-skill authoring, decisions, local Desktop actions, ' +
  'connector setup (create_connector), Nuphos sub-agents (create_thread / send_message_to_thread / update_thread / list_agent_runtimes / set_thread_parent / archive_thread), and channel delivery. ' +
  'When the user asks for a sub-agent (in any language), use create_thread, not your ' +
  "runtime's built-in subagent tool, unless they explicitly ask for the built-in one. " +
  'List yours with list_recent_conversations children:true. ' +
  'When progress needs an answer only the user can provide, use request_user_decision ' +
  'with the actual question and optional choices, then end the turn and wait. ' +
  'This registers the question in Needs your input; a question written only in chat does not. ' +
  'When the user asks for an artifact, a document, or to see HTML, an SVG or a full file ' +
  'rendered, show it with render_artifact; it opens beside the chat. ' +
  'Domain resources use native skills backed by the ' +
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
