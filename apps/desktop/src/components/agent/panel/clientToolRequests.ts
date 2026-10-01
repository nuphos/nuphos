import {
  CLIENT_SIDE_LOCAL_TOOLS,
  pendingClientSideLocalTools,
} from '../../../lib/clientToolPhase.ts'

import type { Message } from './model.ts'
import type { ToolPart } from './parts.ts'
import type { RuntimeRequest } from '../../../lib/runtimeExecution.ts'

type DispatchTab = {
  messages: Message[]
  attachedStreamId?: string | null
  runtimeState?: { requests?: RuntimeRequest[] }
}

export type ClientToolDispatch = { messages: Message[]; tools: ToolPart[] }

// Runs this renderer already started. The runtime keeps listing a request
// until the continuation lands, so a later snapshot must not run it again.
const claimedRequests = new Set<string>()

export function claimClientToolRequests(waitIds: string[]): void {
  for (const waitId of waitIds) claimedRequests.add(waitId)
}

export function clientToolRequestClaimed(waitId: string): boolean {
  return claimedRequests.has(waitId)
}

function hasToolCall(messages: Message[], toolCallId: string): boolean {
  return messages.some((message) =>
    message.parts.some((part) => part.type === 'tool' && part.toolCallId === toolCallId),
  )
}

function withPendingPart(messages: Message[], part: ToolPart): Message[] {
  const last = messages.at(-1)

  if (last?.role === 'assistant') {
    return [...messages.slice(0, -1), { ...last, parts: [...last.parts, part] }]
  }

  return [...messages, { id: `client-tool-${part.toolCallId}`, role: 'assistant', parts: [part] }]
}

/**
 * Whether this device may run the request at all. A request that names its
 * stream runs only where that stream was started. One without (an older
 * backend, or an owner lookup that failed) keeps the streamed-card path, but
 * never on a device that has followed another device's run.
 */
function mayRun(
  tab: DispatchTab,
  request: RuntimeRequest,
  ownsStream: (streamId: string | undefined) => boolean,
): boolean {
  const streamId = request.clientTool?.streamId

  return streamId ? ownsStream(streamId) : !tab.attachedStreamId
}

/**
 * The client tools this device must run now. The runtime's pending request is
 * the source of truth: a tool card that arrived on the stream is used as is,
 * and one a closed stream or a transcript reload lost is rebuilt from the
 * request when the request names this device's stream.
 */
export function selectClientToolDispatch(
  tab: DispatchTab,
  ownsStream: (streamId: string | undefined) => boolean,
  claimed: (waitId: string) => boolean = clientToolRequestClaimed,
): ClientToolDispatch | null {
  const requests = (tab.runtimeState?.requests ?? [])
    .filter((request) => request.kind === 'client-tool' && !claimed(request.waitId))
    .filter((request) => mayRun(tab, request, ownsStream))
    .sort((a, b) => a.createdAt - b.createdAt)
  const pendingParts = pendingClientSideLocalTools(tab.messages).filter(
    (part): part is ToolPart => part.type === 'tool',
  )
  let messages = tab.messages
  const tools: ToolPart[] = []

  for (const request of requests) {
    const streamed = pendingParts.find((part) => part.toolCallId === request.waitId)

    if (streamed) {
      tools.push(streamed)
      continue
    }
    const call = request.clientTool

    if (
      !call?.streamId ||
      !('input' in call) ||
      !CLIENT_SIDE_LOCAL_TOOLS.has(call.toolName) ||
      hasToolCall(messages, request.waitId)
    )
      continue
    const part: ToolPart = {
      type: 'tool',
      toolCallId: request.waitId,
      toolName: call.toolName,
      state: 'input-available',
      input: call.input,
      startedAt: request.createdAt,
    }

    messages = withPendingPart(messages, part)
    tools.push(part)
  }

  return tools.length > 0 ? { messages, tools } : null
}
