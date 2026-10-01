import { reasoningByToolCall } from './journalEventText.ts'

import type { AgentJournalEvent } from '../api'

/**
 * Timeline grouping: the side panel renders a scannable
 * narrative, not the raw event stream. Consecutive tool_call_intent /
 * tool_call_result events pair up by toolCallId into one row; turn_start
 * becomes a separator carrying the turn's base timestamp for relative
 * offsets; turn_end is elided (the boundary is already implied).
 */
export type JournalTimelineItem =
  | { kind: 'turn'; event: AgentJournalEvent }
  | {
      kind: 'tool'
      /** Server tools always have the intent; client-reported results don't. */
      intent: AgentJournalEvent | null
      result: AgentJournalEvent | null
      /** true when the newest journal event — the tool may simply still be running. */
      mayBeRunning: boolean
      /** true when the page is truncated — a missing result may just be unloaded. */
      tailTruncated: boolean
      /** The reasoning the model produced right before this call. */
      reasoning?: string
    }
  | {
      kind: 'message'
      event: AgentJournalEvent
      /** For assistant turns: only the trailing (post-last-tool) reasoning —
       *  the per-tool reasoning lives on the tool rows. */
      trailingReasoning?: string
    }
  | { kind: 'event'; event: AgentJournalEvent }

export function groupJournalEvents(
  events: AgentJournalEvent[],
  opts?: { truncated?: boolean },
): JournalTimelineItem[] {
  const items: JournalTimelineItem[] = []
  const truncated = opts?.truncated === true
  const openTools = new Map<
    string,
    {
      kind: 'tool'
      intent: AgentJournalEvent | null
      result: AgentJournalEvent | null
      mayBeRunning: boolean
      tailTruncated: boolean
      reasoning?: string
    }
  >()
  const lastSeq = events.length > 0 ? events[events.length - 1]!.seq : 0
  // toolCallId -> the reasoning that preceded it, gathered from assistant
  // messages (which journal at turn end, after the tool rows). Back-filled in
  // a second pass so tool rows can show "why this command".
  const reasoningForTool = new Map<string, string>()
  const messageTrailing = new Map<string, string>()

  for (const event of events) {
    switch (event.type) {
      case 'turn_start':
        items.push({ kind: 'turn', event })
        break
      case 'turn_end':
        break
      case 'tool_call_intent': {
        const item = {
          kind: 'tool' as const,
          intent: event,
          result: null,
          mayBeRunning: !truncated && event.seq === lastSeq,
          tailTruncated: truncated,
        }

        items.push(item)
        if (event.session.toolCallId) openTools.set(event.session.toolCallId, item)
        break
      }
      case 'tool_call_result':
      case 'client_tool_result': {
        const open = event.session.toolCallId ? openTools.get(event.session.toolCallId) : undefined

        if (open?.result === null) {
          open.result = event
          open.mayBeRunning = false
          open.tailTruncated = false
        } else {
          items.push({
            kind: 'tool',
            intent: null,
            result: event,
            mayBeRunning: false,
            tailTruncated: false,
          })
        }
        break
      }
      case 'user_message':
        items.push({ kind: 'message', event })
        break
      case 'assistant_message': {
        const item: JournalTimelineItem = { kind: 'message', event }

        items.push(item)
        // Split this turn's reasoning: per-tool goes to reasoningForTool (a
        // later pass attaches it to the tool rows), trailing stays here.
        const { byToolCall, trailing } = reasoningByToolCall(event.contentHot)

        for (const [toolCallId, text] of byToolCall) reasoningForTool.set(toolCallId, text)
        if (trailing) messageTrailing.set(event.eventId, trailing)
        break
      }
      default:
        items.push({ kind: 'event', event })
    }
  }
  // Second pass: attach each split reasoning to its tool row and its trailing
  // portion to the assistant message row (assistant events journal at turn
  // end, after their tool rows, so this must run after the loop).
  for (const item of items) {
    if (item.kind === 'tool') {
      const id = item.intent?.session.toolCallId ?? item.result?.session.toolCallId
      const reasoning = id ? reasoningForTool.get(id) : undefined

      if (reasoning) item.reasoning = reasoning
    } else if (item.kind === 'message') {
      const trailing = messageTrailing.get(item.event.eventId)

      if (trailing) item.trailingReasoning = trailing
    }
  }

  return items
}
