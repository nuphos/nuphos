// Turns AI SDK tools (the classic agent's `tool({ inputSchema, execute })`
// objects) into an MCP tool module. Each call also publishes the same
// tool-input-available / tool-output-available frames the classic loop emits,
// under the ORIGINAL tool name, so the desktop renders its cards unchanged.
import { randomUUID } from 'node:crypto'

import { zodToJsonSchema } from 'zod-to-json-schema'

import { toolError, toolResult } from '@/lib/mcp/protocol'

import { publishPreviewFrame } from '../run-frame-bridge'

import type {
  PreviewToolContext,
  PreviewToolModule,
  PublishPreviewFrame,
} from '../preview-tool-context'
import type { ToolHandler } from '@/lib/mcp/protocol'

export type AiSdkToolLike = {
  description?: string
  inputSchema?: unknown
  execute?: (input: unknown, options: unknown) => unknown
}

type JsonSchemaObject = {
  type?: string
  properties?: Record<string, unknown>
  [key: string]: unknown
}

type ZodLikeSchema = {
  _def: unknown
  parseAsync: (value: unknown) => Promise<unknown>
}

function isZodSchema(value: unknown): value is ZodLikeSchema {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_def' in value &&
    'parseAsync' in value &&
    typeof value.parseAsync === 'function'
  )
}

/** JSON Schema for an AI SDK tool input: zod → draft-07 (no $schema/$ref noise). */
export function toolInputJsonSchema(inputSchema: unknown): JsonSchemaObject {
  if (isZodSchema(inputSchema)) {
    const { $schema: _drop, ...schema } = zodToJsonSchema(inputSchema as never, {
      $refStrategy: 'none',
    }) as JsonSchemaObject & { $schema?: string }

    return schema
  }
  // AI SDK `jsonSchema(...)` wrappers expose the raw schema on `.jsonSchema`.
  if (inputSchema && typeof inputSchema === 'object' && 'jsonSchema' in inputSchema) {
    return (inputSchema as { jsonSchema: JsonSchemaObject }).jsonSchema
  }

  return { type: 'object', properties: {} }
}

function definitionOf(name: string, tool: AiSdkToolLike) {
  return {
    name,
    description: tool.description ?? name,
    inputSchema: toolInputJsonSchema(tool.inputSchema),
  }
}

export function toolModuleFromAiSdkTools(
  tools: Record<string, unknown>,
  options: { publish?: PublishPreviewFrame } = {},
): PreviewToolModule {
  const publish = options.publish ?? publishPreviewFrame
  const entries = Object.entries(tools).filter(
    (entry): entry is [string, AiSdkToolLike] =>
      Boolean(entry[1]) &&
      typeof entry[1] === 'object' &&
      typeof (entry[1] as AiSdkToolLike).execute === 'function',
  )

  return {
    definitions: entries.map(([name, tool]) => definitionOf(name, tool)),
    handlers: (ctx: PreviewToolContext) => {
      const handlers: Record<string, ToolHandler> = {}

      for (const [name, tool] of entries) handlers[name] = adaptExecute(name, tool, ctx, publish)

      return handlers
    },
  }
}

function adaptExecute(
  name: string,
  tool: AiSdkToolLike,
  ctx: PreviewToolContext,
  publish: PublishPreviewFrame,
): ToolHandler {
  return async (args) => {
    const toolCallId = `nuphos-${randomUUID()}`
    const emit = (frame: Record<string, unknown>) =>
      publish(ctx, frame).catch(() => {
        // Frames are best-effort UI; the tool result itself still reaches the agent.
      })

    await emit({ type: 'tool-input-available', toolCallId, toolName: name, input: args })
    try {
      // Unlike the AI SDK loop, the MCP protocol dispatcher does not parse
      // arguments against the advertised schema. Do that here so required
      // fields, refinements, and defaults have identical semantics in the
      // Claude Code runtime instead of falling through to an execute branch.
      const input = isZodSchema(tool.inputSchema) ? await tool.inputSchema.parseAsync(args) : args
      const output = await tool.execute!(input, {
        toolCallId,
        messages: [],
        abortSignal: new AbortController().signal,
      })

      await emit({ type: 'tool-output-available', toolCallId, output: output ?? null })

      return toolResult(output ?? null)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)

      await emit({ type: 'tool-output-error', toolCallId, errorText: message })

      return toolError(message)
    }
  }
}
