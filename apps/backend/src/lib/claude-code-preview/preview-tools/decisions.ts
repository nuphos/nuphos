// Decision tools for the Claude Code runtime. request_user_decision asks and
// returns at once; its card is the agent's own call. Client-side local tools
// park the turn as BLOCKING MCP calls: each publishes its card frames,
// registers a wait, and returns once the decision lands — so Claude continues
// in the same turn and context — or, if nobody answers within
// DECISION_WAIT_MS, returns saying so. One call, one bounded wait: the turn
// never parks on an answer that is not coming.
import { randomUUID } from 'node:crypto'

import { addInputRequest } from '@/lib/agent/db/pending-decision'
import {
  createUserDecisionTools,
  withQuestionsInBody,
  isConnectableProvider,
  cardProblem,
} from '@/lib/agent/tools-skilled/decision-tools'
import { secretFieldsOf, withoutSecretCard } from '@/lib/agent/tools-skilled/decision-secrets'
import { createLocalTools } from '@/lib/agent/tools-skilled/local-tools'
import { toolError, toolResult } from '@/lib/mcp/protocol'
import { logError, logEvent } from '@/lib/observability'

import { computerDesktop } from '../computer-desktop'
import { registerPreviewWait } from '../decision-waiter'
import { previewRunStreamId, publishPreviewFrame } from '../run-frame-bridge'

import { presentedByRuntime, toolInputJsonSchema } from './ai-sdk-adapter'
import { CLIENT_TOOL_INSTRUCTION, CLIENT_TOOL_UNREACHABLE_INSTRUCTION } from './decision-specs'
import {
  aboutRefs,
  askInChannel,
  checkedCall,
  followUpHandler,
  isRequestFollowUp,
  requestOwner,
} from './decision-requests'
import { awaitDecisionOnce } from './decision-wait'

import type { PreviewClientToolCall, PreviewWaitKind } from '../decision-waiter'
import type {
  PreviewToolContext,
  PreviewToolModule,
  PublishPreviewFrame,
} from '../preview-tool-context'
import type { AiSdkToolLike } from './ai-sdk-adapter'
import type { PersonalCredentialRef } from '@/lib/agent/tools-skilled/decision-tools'
import type { ExplicitUserDecision } from '@/lib/agent/tools-skilled/types'
import type { ToolHandler } from '@/lib/mcp/protocol'

type ClassicTools = Record<string, unknown>

const REQUEST = 'request_user_decision'

function classicDecisionTools(): ClassicTools {
  return createUserDecisionTools({ agentOrigin: 'user', onExplicitUserDecision: () => {} })
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

/**
 * `request_user_decision`: asks without parking the turn, and the answer arrives in a
 * new message. Its card is the agent's own call, the step the transcript stores, so a
 * card drawn while the turn runs is the same card after it ends.
 */
function requestHandler(
  tool: AiSdkToolLike,
  ctx: PreviewToolContext,
  options: BlockOptions,
): ToolHandler {
  const handle = async (raw: Record<string, unknown>) => {
    // Written out in the body too, for clients that draw only question and body.
    const written = withQuestionsInBody(raw)
    const args = written === undefined ? raw : { ...raw, body: written }
    // What the agent is told it asked: the Desktop app draws the Connect and secure input
    // cards and a phone the secure input card; elsewhere (Slack, Discord, Lark) the question
    // goes out as plain text.
    const { providers: _providers, credentials: _credentials, ...phone } = args
    const shown =
      ctx.localTools === true ? args : ctx.secretCard === true ? phone : withoutSecretCard(phone)
    const target = cardProblem(args)

    if (target) return toolError(target)
    const about = await aboutRefs(ctx, args.about)

    if (typeof about === 'string') return toolError(about)
    const desktop =
      args.category === 'computer' ? await computerDesktop(ctx.teamId, ctx.sessionId) : undefined

    if (typeof desktop === 'string') return toolError(desktop)

    return presentedByRuntime(options.publish, ctx, REQUEST, shown, async (toolCallId) => {
      const output = (await tool.execute!(shown, {
        toolCallId,
        messages: [],
        abortSignal: new AbortController().signal,
      })) as ExplicitUserDecision & Record<string, unknown>
      const { category, question, body, options: choices, multiSelect, questions } = output

      await addInputRequest(ctx.sessionId, requestOwner(ctx), {
        id: toolCallId,
        ...(await askInChannel(ctx, category, question)),
        category,
        question,
        ...(body ? { body } : {}),
        ...(choices ? { options: choices } : {}),
        ...(multiSelect ? { multiSelect } : {}),
        ...(questions ? { questions } : {}),
        // From args, as a channel turn's card drops them: the Inbox and a Bot's chat
        // still draw the secure input or Connect card from the record.
        ...(category === 'credential' && typeof args.secretName === 'string'
          ? { secretName: args.secretName }
          : {}),
        ...secretFieldsOf(args),
        ...(category === 'integration' && Array.isArray(args.providers)
          ? { providers: args.providers.filter(isConnectableProvider) }
          : {}),
        ...(category === 'integration' && Array.isArray(args.credentials)
          ? { credentials: args.credentials as PersonalCredentialRef[] }
          : {}),
        ...(about.length ? { about } : {}),
        ...(desktop ? { desktop } : {}),
        askedAt: new Date(),
      }).catch((err: unknown) => {
        // The card is already in the transcript; only the Inbox misses it.
        logError('agent.pending_decision.persist_failed', err, { session_id: ctx.sessionId })
      })

      return { ...output, ...(desktop ? { desktop } : {}), requestId: toolCallId }
    })
  }

  return (call) => checkedCall(tool, call, handle)
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
  const classic = classicDecisionTools()
  const localTools = createLocalTools(true)

  return {
    definitions: [...definitionsOf(classic), ...definitionsOf(localTools)],
    handlers: (ctx) => {
      const handlers: Record<string, ToolHandler> = {}

      for (const [name, tool] of Object.entries(classic)) {
        if (!isToolLike(tool)) continue
        if (isRequestFollowUp(name)) handlers[name] = followUpHandler(name, tool, ctx)
        else if (name === REQUEST && typeof tool.execute === 'function')
          handlers[name] = requestHandler(tool, ctx, block)
      }
      for (const name of Object.keys(localTools))
        handlers[name] = clientToolHandler(name, ctx, block)

      return handlers
    },
  }
}
