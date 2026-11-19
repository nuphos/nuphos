// A team's conversation changes, pushed to its members' apps so a chat on screen
// catches up at once instead of on its next poll (#3523). Lossy by design: a
// client that reconnects revalidates what it shows.
import { errorMessage, logEvent } from '@/lib/observability'

import { generalAccessOf, isParticipant } from './db/access'
import { agentConversations } from './db/shared'

import type { AgentConversation } from './db/shared'
import type { ChangeStream, ChangeStreamDocument } from 'mongodb'

/** What decides who hears of a change, read from the conversation as it is now. */
export type ChangedConversation = Pick<
  AgentConversation,
  'sessionId' | 'teamId' | 'userId' | 'generalAccess' | 'kind' | 'participantIds'
> & { transcriptUpdatedAt?: Date }

/** What a viewer hears: which conversation changed, never what it says. */
export type ConversationChange = { sessionId: string; revision: string }

/** A member's membership is checked again at least this often, so a removed member stops hearing. */
export const MEMBERSHIP_RECHECK_MS = 30_000

/**
 * Whether `viewerId`, a member of `teamId`, may hear that the conversation changed: the
 * same rule as reading it (readsConversation), from its grants at the time of the change.
 */
export function seesChange(conversation: ChangedConversation, teamId: string, viewerId: string) {
  if (conversation.teamId !== teamId) return false

  return (
    conversation.userId === viewerId ||
    isParticipant(conversation, viewerId) ||
    generalAccessOf(conversation) !== 'none'
  )
}

// What a chat on screen shows: its messages, title, members and faces (channelRevision).
const WATCHED = [
  'transcriptUpdatedAt',
  'messageCount',
  'title',
  'agentSessionIds',
  'faces',
  'timelineEvents',
]

type Listener = (conversation: ChangedConversation) => void

const listeners = new Map<string, Set<Listener>>()
let stream: ChangeStream<AgentConversation> | null = null
let failures = 0

function watch() {
  if (stream) return
  const opened = agentConversations().watch<
    AgentConversation,
    ChangeStreamDocument<AgentConversation>
  >(
    [
      {
        $match: {
          $or: [
            { operationType: 'insert' },
            ...WATCHED.map((field) => ({
              [`updateDescription.updatedFields.${field}`]: { $exists: true },
            })),
          ],
        },
      },
      {
        $project: Object.fromEntries(
          [
            'sessionId',
            'teamId',
            'userId',
            'generalAccess',
            'kind',
            'participantIds',
            'transcriptUpdatedAt',
          ].map((field) => [`fullDocument.${field}`, 1]),
        ),
      },
    ],
    { fullDocument: 'updateLookup' },
  )

  stream = opened
  opened.on('change', (event) => {
    const conversation = 'fullDocument' in event ? event.fullDocument : undefined

    if (!conversation?.teamId) return
    for (const listener of listeners.get(conversation.teamId) ?? []) listener(conversation)
  })
  opened.on('change', () => {
    failures = 0
  })
  opened.on('error', (error) => {
    if (stream === opened) stream = null
    void opened.close().catch(() => undefined)
    // Once per run of failures: a MongoDB that isn't a replica set fails every time.
    if (failures === 0)
      logEvent('warn', 'agent.conversation_changes.stream_failed', { error: errorMessage(error) })
    failures += 1
    // Clients revalidate when their stream ends; this keeps the next ones hearing, backing off to a minute.
    if (listeners.size > 0) setTimeout(watch, Math.min(60_000, 1_000 * 2 ** (failures - 1))).unref()
  })
}

/** Hears every change to a team's conversations; one change stream serves every listener. */
export function onConversationChange(teamId: string, listener: Listener): () => void {
  const team = listeners.get(teamId) ?? new Set()

  team.add(listener)
  listeners.set(teamId, team)
  watch()

  return () => {
    team.delete(listener)
    if (team.size === 0) listeners.delete(teamId)
    if (listeners.size === 0 && stream) {
      void stream.close().catch(() => undefined)
      stream = null
    }
  }
}

type StreamDeps = {
  teamId: string
  viewerId: string
  subscribe: (teamId: string, listener: Listener) => () => void
  isMember: () => Promise<boolean>
  heartbeatMs: number
  now?: () => number
}

/**
 * The SSE body for one member: a `data:` line per change they may read, a comment as a
 * heartbeat. It ends once they are no longer a member, checked at least every 30 s.
 */
export function conversationChangesBody({
  teamId,
  viewerId,
  subscribe,
  isMember,
  heartbeatMs,
  now = Date.now,
}: StreamDeps): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let closed = false
  let checkedAt = now()

  const stop = () => {
    closed = true
    unsubscribe?.()
    clearInterval(timer)
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          stop()
        }
      }
      const end = () => {
        if (closed) return
        stop()
        controller.close()
      }
      // A member removed since the last check hears nothing more.
      const stillMember = async () => {
        if (now() - checkedAt < MEMBERSHIP_RECHECK_MS) return true
        checkedAt = now()
        const member = await isMember().catch(() => false)

        if (!member) end()

        return member
      }

      unsubscribe = subscribe(teamId, (conversation) => {
        if (!seesChange(conversation, teamId, viewerId)) return
        const change: ConversationChange = {
          sessionId: conversation.sessionId,
          revision: conversation.transcriptUpdatedAt?.toISOString() ?? '',
        }

        void stillMember().then((member) => {
          if (member) send(`data: ${JSON.stringify(change)}\n\n`)
        })
      })
      send(': ready\n\n')
      timer = setInterval(() => {
        send(': heartbeat\n\n')
        void stillMember()
      }, heartbeatMs)
    },
    cancel: stop,
  })
}
