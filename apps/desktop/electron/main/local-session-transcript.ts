// Reads a whole Claude Code / Codex session log into the transcript shape
// Nuphos stores, so a local conversation can be continued on a team agent.
// Only the human-readable turns survive: tool calls, sub-agent side chains and
// harness preambles are the runtime's own business, not the conversation.
import fs from 'node:fs/promises'
import path from 'node:path'

import {
  cleanSessionTitle,
  isConversationPrompt,
  textFromMessageContent,
} from './local-sessions.ts'

import type { LocalSessionSource } from './local-sessions.ts'

export type ImportedTranscriptMessage = {
  id: string
  role: 'user' | 'assistant'
  parts: { type: 'text'; text: string }[]
}

export type ImportedTranscript = {
  title: string
  messages: ImportedTranscriptMessage[]
  /** Turns left out by the caps below. */
  dropped: number
}

/** A session log this large is not a conversation worth importing whole. */
const MAX_FILE_BYTES = 64 * 1024 * 1024
const MAX_MESSAGES = 200
const MAX_MESSAGE_CHARS = 8_000
const MAX_TOTAL_CHARS = 1_000_000

type Turn = { role: 'user' | 'assistant'; text: string }

function record(line: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(line)

    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function payloadOf(item: Record<string, unknown>): Record<string, unknown> | null {
  return item.payload && typeof item.payload === 'object'
    ? (item.payload as Record<string, unknown>)
    : null
}

/** Claude Code writes one record per message, with the API message inside. */
function claudeTurn(item: Record<string, unknown>): Turn | null {
  if (item.type !== 'user' && item.type !== 'assistant') return null
  // Sub-agent transcripts and harness-injected records are not conversation.
  if (item.isSidechain === true || item.isMeta === true) return null
  const message =
    item.message && typeof item.message === 'object'
      ? (item.message as Record<string, unknown>)
      : null
  const text = textFromMessageContent(message?.content)

  if (!text?.trim()) return null

  return { role: item.type, text }
}

/** Codex writes the model's own response items plus UI events. */
function codexTurn(item: Record<string, unknown>): Turn | null {
  const payload = payloadOf(item)

  if (!payload) return null
  if (item.type === 'response_item' && payload.type === 'message') {
    const role =
      payload.role === 'user' ? 'user' : payload.role === 'assistant' ? 'assistant' : null
    const text = role ? textFromMessageContent(payload.content) : null

    return role && text?.trim() ? { role, text } : null
  }
  if (item.type === 'event_msg' && typeof payload.message === 'string') {
    if (payload.type === 'user_message') return { role: 'user', text: payload.message }
    if (payload.type === 'agent_message') return { role: 'assistant', text: payload.message }
  }

  return null
}

/** Consecutive same-role records are one turn: both agents split a single
 *  answer across several content blocks. */
function appendTurn(turns: Turn[], turn: Turn): void {
  const last = turns[turns.length - 1]

  if (last?.role === turn.role) {
    last.text = `${last.text}\n\n${turn.text}`

    return
  }
  turns.push(turn)
}

function withinBudget(turns: Turn[]): { kept: Turn[]; dropped: number } {
  const kept: Turn[] = []
  let chars = 0

  // Newest first: a long session keeps its tail, which is what the agent needs.
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index]

    if (!turn) continue
    if (kept.length >= MAX_MESSAGES || chars >= MAX_TOTAL_CHARS) break
    const text = turn.text.slice(0, MAX_MESSAGE_CHARS)

    kept.unshift({ role: turn.role, text })
    chars += text.length
  }

  return { kept, dropped: turns.length - kept.length }
}

export async function readLocalSessionTranscript(
  source: LocalSessionSource,
  filePath: string,
): Promise<ImportedTranscript> {
  const stat = await fs.stat(filePath)

  if (stat.size > MAX_FILE_BYTES) {
    throw new Error('This session log is too large to import.')
  }
  const text = await fs.readFile(filePath, 'utf8')
  const turns: Turn[] = []
  let aiTitle: string | null = null

  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const item = record(line)

    if (!item) continue
    if (item.type === 'ai-title' && typeof item.aiTitle === 'string') aiTitle ??= item.aiTitle
    const turn = source === 'claude-code' ? claudeTurn(item) : codexTurn(item)

    if (!turn) continue
    // Harness preambles (AGENTS.md, environment context, memory summaries) are
    // re-supplied by the runtime this conversation moves to.
    if (turn.role === 'user' && !isConversationPrompt(turn.text)) continue
    appendTurn(turns, { role: turn.role, text: turn.text.trim() })
  }

  const { kept, dropped } = withinBudget(turns)
  const fallback = path.basename(filePath, '.jsonl').replace(/^rollout-/u, '')
  const firstUser = kept.find((turn) => turn.role === 'user')?.text ?? null

  return {
    title: cleanSessionTitle(aiTitle ?? firstUser, fallback),
    messages: kept.map((turn, index) => ({
      id: `imported-${String(index)}`,
      role: turn.role,
      parts: [{ type: 'text' as const, text: turn.text }],
    })),
    dropped,
  }
}
