import { textDeltaInsertionIndex } from '../../../lib/agentMessagePartOrder'

import { STREAM_CHUNK_SIZES, STREAM_DELAY_MS } from './constants'
import { isHiddenMemoryIngestPart } from './parts'
import { uid } from './stall'

import type { Message, Tab } from './model'
import type { Part } from './parts'

export function appendTextDelta(parts: Part[], delta: string): Part[] {
  if (!delta) return parts
  const insertAt = textDeltaInsertionIndex(parts)
  const previous = parts[insertAt - 1]

  if (previous?.type === 'text') {
    const next = parts.slice()

    next[insertAt - 1] = { ...previous, text: previous.text + delta }

    return next
  }
  const next = parts.slice()

  next.splice(insertAt, 0, { type: 'text', text: delta })

  return next
}

// Pure tab-level fold of a text delta into the trailing assistant message,
// creating one if needed. Used both by the live setTabs path (appendTextToStream)
// and by handleEndEvent to compute a post-flush snapshot in-place so the resume
// payload reflects every chunk the user just saw — not a stale tabsRef value.
export function foldTextDeltaIntoTab(tab: Tab, delta: string): Tab {
  if (!delta) return tab
  const msgs = tab.messages.slice()
  const last = msgs[msgs.length - 1]
  let assistant: Message

  if (last?.role === 'assistant') {
    assistant = last
  } else {
    assistant = { id: uid(), role: 'assistant', parts: [] }
    msgs.push(assistant)
  }
  const nextParts = appendTextDelta(assistant.parts, delta)

  if (nextParts === assistant.parts) return tab
  msgs[msgs.length - 1] = { ...assistant, parts: nextParts }

  return { ...tab, connected: true, messages: msgs }
}

export function hasIncompleteTrailingMarkdownLink(text: string, rest: string): boolean {
  const tail = text.slice(-512)
  const labelAtEnd = /!?\[[^\]\n]{1,200}\]$/.test(tail)

  if (labelAtEnd && (rest.length === 0 || /^[([]/.test(rest))) return true

  const linkStart = /!?\[[^\]\n]{1,200}\]\([^)\n]*$/.exec(tail)

  return Boolean(linkStart)
}

export function takeStreamChunk(buffer: string): { chunk: string; rest: string } {
  const chars = Array.from(buffer)
  let target = STREAM_CHUNK_SIZES.short

  if (chars.length > 480) target = STREAM_CHUNK_SIZES.backlog
  else if (chars.length > 160) target = STREAM_CHUNK_SIZES.long
  else if (chars.length > 48) target = STREAM_CHUNK_SIZES.medium

  const limit = Math.min(chars.length, target)
  let cut = limit
  const minCut = Math.min(4, limit)

  for (let i = minCut; i < limit; i += 1) {
    if (/[\s,.;:!?，。！？、）\]}]/.test(chars[i])) {
      cut = i + 1
      break
    }
  }

  let chunk = chars.slice(0, cut).join('')
  let rest = chars.slice(cut).join('')
  const chunkEndsWithLinkLabel = /!?\[[^\]\n]{1,200}\]$/.test(chunk.slice(-512))

  if (chunkEndsWithLinkLabel && rest.startsWith('(')) {
    const linkEnd = rest.indexOf(')')

    if (linkEnd === -1) return { chunk: '', rest: buffer }
    chunk += rest.slice(0, linkEnd + 1)
    rest = rest.slice(linkEnd + 1)
  }
  if (chunkEndsWithLinkLabel && rest.startsWith('[')) {
    const referenceEnd = rest.indexOf(']')

    if (referenceEnd === -1) return { chunk: '', rest: buffer }
    chunk += rest.slice(0, referenceEnd + 1)
    rest = rest.slice(referenceEnd + 1)
  }
  if (hasIncompleteTrailingMarkdownLink(chunk, rest)) {
    return { chunk: '', rest: buffer }
  }

  return {
    chunk,
    rest,
  }
}

export function streamDelayFor(bufferLength: number): number {
  if (bufferLength > 480) return STREAM_DELAY_MS.backlog
  if (bufferLength > 160) return STREAM_DELAY_MS.busy

  return STREAM_DELAY_MS.normal
}

export function lastVisiblePartIndex(parts: Part[]): number {
  return parts.reduce((lastTextIndex, part, partIndex) => {
    const visibleText = part.type === 'text' && part.text.trim().length > 0
    const visibleTool = part.type === 'tool' && part.toolName !== 'skill'
    const visibleMemoryEvent = part.type === 'memory-ingest' && !isHiddenMemoryIngestPart(part)

    return visibleText || visibleTool || visibleMemoryEvent ? partIndex : lastTextIndex
  }, -1)
}

// Wall-clock span of a turn's tool activity: earliest tool start → latest tool
// finish. Null when no tool carries timestamps (e.g. a narration-only turn).
export function turnWorkSeconds(parts: Part[]): number | null {
  let start = Infinity
  let end = -Infinity

  for (const p of parts) {
    if (p.type !== 'tool' || typeof p.startedAt !== 'number') continue
    start = Math.min(start, p.startedAt)
    end = Math.max(end, p.completedAt ?? p.startedAt)
  }
  if (!Number.isFinite(start)) return null

  return Math.max(0, Math.round((end - start) / 1000))
}

// Client-side stand-in for the backend's first-persisted time (turn end):
// stamps the just-finished turn's assistant message so the hover timestamp
// renders without a reload.
export function stampAssistantTurnEnd(messages: Message[]): Message[] {
  const last = messages[messages.length - 1]

  if (last?.role !== 'assistant' || last.createdAt) return messages

  return [...messages.slice(0, -1), { ...last, createdAt: Date.now() }]
}

export function formatMessageTimestamp(ms: number): string {
  const d = new Date(ms)
  const now = new Date()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  if (d.toDateString() === now.toDateString()) return time
  const date = d.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })

  return `${date}, ${time}`
}

export function formatWorkDuration(totalSeconds: number): string {
  const s = Math.max(1, totalSeconds)

  if (s < 60) return `${String(s)}s`
  const m = Math.floor(s / 60)

  if (m < 60) return s % 60 > 0 ? `${String(m)}m ${String(s % 60)}s` : `${String(m)}m`
  const h = Math.floor(m / 60)

  return m % 60 > 0 ? `${String(h)}h ${String(m % 60)}m` : `${String(h)}h`
}

export function assistantPartKey(
  part: Part,
  index: number,
  counts: Record<string, number>,
): string {
  if (part.type === 'tool') return `tool:${part.toolCallId}`
  if (part.type === 'memory-ingest') return `memory:${part.id}`
  if (part.type === 'memory-provenance') return `memprov:${part.id}`
  if (part.type === 'turn-interrupted') return `interrupted:${part.id}`
  const countFor = (type: string) => {
    const next = counts[type] ?? 0

    counts[type] = next + 1

    return next
  }

  if (part.type === 'text') return `text:${String(countFor('text'))}`
  if (part.type === 'reasoning') return `reasoning:${String(countFor('reasoning'))}`
  if (part.type === 'step-start') return `step:${String(countFor('step'))}`
  if (part.type === 'local-file')
    return `file:${String(part.path || index)}:${String(countFor('file'))}`
  if (part.type === 'image')
    return `img:${String(part.fileName || index)}:${String(countFor('img'))}`
  if (part.type === 'transfer-upload')
    return `transfer:${part.groupId}:${String(countFor('transfer'))}`

  return `part:${String(index)}`
}

export function hasRenderableAssistantContent(messages: Message[]): boolean {
  const last = messages[messages.length - 1]

  if (last?.role !== 'assistant') return false

  return last.parts.some((p) => {
    if (p.type === 'text') return p.text.trim().length > 0
    if (p.type === 'tool') return p.toolName !== 'skill'

    return false
  })
}
