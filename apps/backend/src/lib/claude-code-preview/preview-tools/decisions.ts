// Decision tools for the Claude Code runtime: the classic tools that park a
// turn on a human (permission grants, Auto Mode rules, an explicit user
// choice, client-side local tools) become BLOCKING MCP calls.
// Each publishes the classic card frames, registers a wait, and returns once
// the decision lands — so Claude continues in the same turn and context — or,
// if nobody answers within DECISION_WAIT_MS, returns saying so. One call, one
// bounded wait: the turn never parks on an answer that is not coming.
import { randomUUID } from 'node:crypto'

import {
  createAutoModeTools,
  createUserDecisionTools,
} from '@/lib/agent/tools-skilled/decision-tools'
import { createLocalTools } from '@/lib/agent/tools-skilled/local-tools'
import { toolError, toolResult } from '@/lib/mcp/protocol'
import { logEvent } from '@/lib/observability'

import { registerPreviewWait } from '../decision-waiter'
import { previewRunStreamId, publishPreviewFrame } from '../run-frame-bridge'

import { toolInputJsonSchema } from './ai-sdk-adapter'
import {
  CLIENT_TOOL_INSTRUCTION,
  CLIENT_TOOL_UNREACHABLE_INSTRUCTION,
  DECISION_SPECS,
} from './decision-specs'
import { awaitDecisionOnce } from './decision-wait'

import type { PreviewClientToolCall, PreviewWaitKind } from '../decision-waiter'
import type {
  PreviewToolContext,
  PreviewToolModule,
  PublishPreviewFrame,
} from '../preview-tool-context'
import type { AiSdkToolLike } from './ai-sdk-adapter'
import type { DecisionSpec } from './decision-specs'
import type { ToolHandler } from '@/lib/mcp/protocol'

type ClassicTools = Record<string, unknown>

function classicDecisionTools(ctx: PreviewToolContext): ClassicTools {
  return {
    ...createAutoModeTools({
      userId: ctx.userId,
      conversationId: ctx.sessionId,
      onAwaitUserDecision: () => {},
    }),
    ...createUserDecisionTools({ agentOrigin: 'user', onExplicitUserDecision: () => {} }),
  }
}

function isToolLike(value: unknown): value is AiSdkToolLike {
  return Boolean(value) && typeof value === 'object'
}

function definitionsOf(tools: ClassicTools) {
  return Object.entries(tools)
    .filter((entry): entry is [string, AiSdkToolLike] => isToolLike(entry[1]))
    .map(([name, tool]) => ({
      name,
      description: tool.description ?? name,
      inputSchema: toolInputJsonSchema(tool.inputSchema),
    }))
}

type BlockOptions = {
  publish: PublishPreviewFrame
  runStreamId: (ctx: PreviewToolContext) => Promise<string | undefined>
  timeoutMs?: number
}

// The call rides on every runtime snapshot; an oversized input is left to the stream frame.
const MAX_DURABLE_INPUT_CHARS = 32_768

async function blockForDecision(
  ctx: PreviewToolContext,
  args: {
    toolCallId: string
    kind: PreviewWaitKind
    ref?: string
    clientTool?: PreviewClientToolCall
    instruction: string
  },
  base: Record<string, unknown>,
  options: BlockOptions,
) {
  await registerPreviewWait({
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    waitId: args.toolCallId,
    kind: args.kind,
    ...(args.ref ? { ref: args.ref } : {}),
    ...(args.clientTool ? { clientTool: args.clientTool } : {}),
  })
  const outcome = await awaitDecisionOnce({
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    waitId: args.toolCallId,
    kind: args.kind,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  })

  if (outcome.status === 'decided')
    return toolResult({ ...base, ...outcome.decision.payload, instruction: args.instruction })
  logEvent('info', 'agent.preview_decision.unanswered', {
    session_id: ctx.sessionId,
    user_id: ctx.userId,
    wait_kind: args.kind,
    wait_id: args.toolCallId,
  })
  // The transcript card must say what the model was told: the wait is over.
  await options
    .publish(ctx, {
      type: 'tool-output-error',
      toolCallId: args.toolCallId,
      errorText: outcome.cardText,
    })
    .catch(() => {})

  return toolResult({ ...base, ...outcome.payload })
}

type ClassicOutcome =
  { toolCallId: string; output: Record<string, unknown> } | { toolCallId: string; error: string }

/** Runs the classic tool with its card frames published, exactly as the classic loop would. */
async function runClassicTool(
  name: string,
  tool: AiSdkToolLike,
  args: Record<string, unknown>,
  ctx: PreviewToolContext,
  options: BlockOptions,
): Promise<ClassicOutcome> {
  const toolCallId = `nuphos-${randomUUID()}`
  const emit = (frame: Record<string, unknown>) =>
    options.publish(ctx, frame).catch(() => {
      // Frames are best-effort UI; the decision still flows through the waiter.
    })

  await emit({ type: 'tool-input-available', toolCallId, toolName: name, input: args })
  try {
    const raw = await tool.execute!(args, {
      toolCallId,
      messages: [],
      abortSignal: new AbortController().signal,
    })
    const output =
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : { result: raw }

    await emit({ type: 'tool-output-available', toolCallId, output })

    return { toolCallId, output }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)

    await emit({ type: 'tool-output-error', toolCallId, errorText: error })

    return { toolCallId, error }
  }
}

/**
 * Classic tools that do not park the turn (`request_user_decision`: the model
 * ends the turn with its question and the user's next message is the answer).
 */
function passthroughHandler(
  name: string,
  tool: AiSdkToolLike,
  ctx: PreviewToolContext,
  options: BlockOptions,
): ToolHandler {
  return async (args) => {
    const outcome = await runClassicTool(name, tool, args, ctx, options)

    return 'error' in outcome ? toolError(outcome.error) : toolResult(outcome.output)
  }
}

function blockingHandler(
  name: string,
  tool: AiSdkToolLike,
  spec: DecisionSpec,
  ctx: PreviewToolContext,
  options: BlockOptions,
): ToolHandler {
  return async (args) => {
    const outcome = await runClassicTool(name, tool, args, ctx, options)

    if ('error' in outcome) return toolError(outcome.error)
    const { toolCallId, output } = outcome

    if (typeof output.error === 'string') return toolResult(output)

    return blockForDecision(
      ctx,
      { toolCallId, kind: spec.kind, ref: spec.ref?.(output), instruction: spec.instruction },
      output,
      options,
    )
  }
}

function clientToolHandler(
  name: string,
  ctx: PreviewToolContext,
  options: BlockOptions,
): ToolHandler {
  return async (args) => {
    if (ctx.localTools !== true)
      return toolResult({
        tool: name,
        status: 'unavailable',
        reason: 'no_desktop_session',
        instruction: CLIENT_TOOL_UNREACHABLE_INSTRUCTION,
      })
    const toolCallId = `nuphos-${randomUUID()}`
    const streamId = await options.runStreamId(ctx).catch(() => {})
    const durableInput = JSON.stringify(args).length <= MAX_DURABLE_INPUT_CHARS
    const clientTool: PreviewClientToolCall = {
      toolName: name,
      ...(durableInput ? { input: args } : {}),
      ...(streamId ? { streamId } : {}),
    }

    await options
      .publish(ctx, { type: 'tool-input-available', toolCallId, toolName: name, input: args })
      .catch(() => {})

    // No `ref`: a client tool is addressed by its waitId, and a ref keyed on the
    // tool name would collide across every session that runs the same tool.
    return blockForDecision(
      ctx,
      { toolCallId, kind: 'client-tool', clientTool, instruction: CLIENT_TOOL_INSTRUCTION },
      { tool: name },
      options,
    )
  }
}

export function decisionToolModule(options: Partial<BlockOptions> = {}): PreviewToolModule {
  const block: BlockOptions = {
    ...options,
    publish: options.publish ?? publishPreviewFrame,
    runStreamId: options.runStreamId ?? previewRunStreamId,
  }
  const sample = classicDecisionTools({
    userId: '',
    teamId: '',
    sessionId: '',
    locale: 'en',
  })
  const localTools = createLocalTools(true)

  return {
    definitions: [...definitionsOf(sample), ...definitionsOf(localTools)],
    handlers: (ctx) => {
      const handlers: Record<string, ToolHandler> = {}

      for (const [name, tool] of Object.entries(classicDecisionTools(ctx))) {
        if (!isToolLike(tool) || typeof tool.execute !== 'function') continue
        const spec = DECISION_SPECS[name]

        handlers[name] = spec
          ? blockingHandler(name, tool, spec, ctx, block)
          : passthroughHandler(name, tool, ctx, block)
      }
      for (const name of Object.keys(localTools))
        handlers[name] = clientToolHandler(name, ctx, block)

      return handlers
    },
  }
}
