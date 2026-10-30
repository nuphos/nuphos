import { readableByFilter } from './access'
import { OPEN_INPUT_REQUEST_FILTER } from './pending-decision'
import { agentConversations, escapeRegExp } from './shared'

import type { AgentConversation } from './shared'

export type ConversationsScope = 'mine' | 'team' | 'shared'
export type ConversationsArchivedFilter = 'exclude' | 'only'
export type ConversationsSort = 'activity' | 'created' | 'archived'

const CONVERSATION_SORT_FIELDS = {
  activity: 'lastActiveAt',
  created: 'createdAt',
  archived: 'archivedAt',
} as const satisfies Record<ConversationsSort, keyof AgentConversation>

/**
 * teamId is required, and deliberately so: every listing is a question about
 * one team. It used to be optional, and a caller that failed to supply one got
 * the viewer's chats from every team they belong to — a plausible-looking list
 * that silently crossed the team boundary the caller thought it was inside.
 * There is no "all my teams" feed; ask per team.
 */
export async function getConversations(
  viewerUserId: string,
  options: {
    teamId: string
    limit?: number
    cursor?: string
    scope?: ConversationsScope
    /** Restrict to one team member's conversations, for the Chats reader's
     *  member filter. Only meaningful in team scope, where every member's
     *  conversations are already visible. */
    ownerId?: string
    search?: string
    /** Sort newest-first by recent activity (default), creation time, or
     *  archive time — the last lists archived conversations only. */
    sort?: ConversationsSort
    // Omitted = archived and unarchived both list (existing consumers keep
    // seeing everything); 'exclude' powers the sidebar, 'only' the archive.
    archived?: ConversationsArchivedFilter
    /**
     * A trigger's run history. Omitted means the other side of the same coin:
     * Chats, which excludes every trigger-stamped conversation — a run belongs
     * to its Trigger, not to the chat list. An empty array is a Watch group
     * with no partitions yet, and matches nothing rather than degrading into
     * the unfiltered list.
     *
     * Conversations from before the stamp existed carry no `metadata.trigger`,
     * so they stay in Chats. There is nothing to attribute them to, and
     * hiding them would strand them in a Runs list they can never reach.
     */
    triggerIds?: string[]
    parentSessionId?: string // Only threads nested under this conversation: its sub-agents.
    /** The Inbox: only conversations waiting on a decision, trigger runs included. */
    pendingDecision?: boolean
    /** Also return the rows' parents that another page would list. */
    withParents?: boolean
  },
): Promise<{
  conversations: AgentConversation[]
  /** Only with `withParents`; see listedParents. */
  parents: AgentConversation[]
  nextCursor: string | null
  hasMore: boolean
}> {
  if (!options.teamId) throw new Error('getConversations requires a teamId')
  const limit = options.limit ?? 20
  // Scoping rules:
  //   'mine'   → only the viewer's chats within that team (default — what
  //              "Recent" intuitively means to the viewer)
  //   'team'   → every team member's chats (old default; opt-in now)
  //   'shared' → chats the viewer joined but does not own. The complement of
  //              'mine' within what the sidebar shows, so the two lists
  //              together never repeat a conversation.
  const scope: ConversationsScope = options.scope ?? 'mine'
  const sortField = CONVERSATION_SORT_FIELDS[options.sort ?? 'activity']
  const query: Record<string, unknown> = {
    teamId: options.teamId,
    // Kept apart from the search $or below, which would otherwise replace it.
    $and: [readableByFilter(viewerUserId)],
  }

  if (scope === 'mine') query.userId = viewerUserId
  if (scope === 'shared') {
    query.participantIds = viewerUserId
    query.userId = { $ne: viewerUserId }
  }

  // Narrowing team scope to one member reads the same as 'mine' with someone
  // else's id, limited like every scope to what the viewer may read.
  if (scope === 'team' && options.ownerId) query.userId = options.ownerId
  if (options.parentSessionId) query.parentSessionId = options.parentSessionId
  // Inside $and, so the search $or below cannot replace it.
  if (options.pendingDecision) (query.$and as unknown[]).push(OPEN_INPUT_REQUEST_FILTER)
  else
    query['metadata.trigger.id'] = options.triggerIds
      ? { $in: options.triggerIds }
      : { $exists: false }
  if (options.archived === 'only' || options.sort === 'archived') {
    query.archivedAt = { $exists: true }
  } else if (options.archived === 'exclude') {
    query.archivedAt = { $exists: false }
  }
  const search = options.search?.trim()

  if (search) {
    // Substring match, not full-text: history search targets short titles /
    // first messages, where regex is predictable. The user/team index prefix
    // keeps the scan bounded to the viewer's own documents.
    const pattern = new RegExp(escapeRegExp(search), 'i')

    query.$or = [{ title: pattern }, { firstMessage: pattern }]
  }
  const filters = { ...query }

  if (options.cursor) {
    query[sortField] = {
      ...(query[sortField] as Record<string, unknown> | undefined),
      $lt: new Date(options.cursor),
    }
  }

  const conversations = await agentConversations()
    .find(query)
    .sort({ [sortField]: -1 })
    .limit(limit + 1)
    .toArray()

  const hasMore = conversations.length > limit

  if (hasMore) conversations.pop()

  const last = conversations[conversations.length - 1]
  const nextCursor = hasMore ? (last?.[sortField]?.toISOString() ?? null) : null
  const parents = options.withParents
    ? await listedParents(viewerUserId, scope, filters, conversations)
    : []

  return { conversations, parents, nextCursor, hasMore }
}

/**
 * The rows' parents, and theirs, that the same listing shows on any page, so
 * a client that pages can nest each thread under its parent right away. A parent
 * the listing would not show (archived, filtered out by the search) is not
 * returned, and the thread stays top-level, as in the desktop sidebar, which
 * nests over every page. Shared chats count beside the viewer's own: a shared
 * thread nests under the viewer's chat that opened it.
 */
async function listedParents(
  viewerUserId: string,
  scope: ConversationsScope,
  filters: Record<string, unknown>,
  rows: AgentConversation[],
): Promise<AgentConversation[]> {
  const query = { ...filters }

  if (scope !== 'team') {
    delete query.userId
    delete query.participantIds
    query.$and = [
      ...(filters.$and as unknown[]),
      { $or: [{ userId: viewerUserId }, { participantIds: viewerUserId }] },
    ]
  }
  const seen = new Set(rows.map((row) => row.sessionId))
  const parents: AgentConversation[] = []
  let level = rows

  // Bounded like any thread chain a client would draw.
  for (let depth = 0; depth < 10; depth++) {
    const ids = [...new Set(level.flatMap((row) => row.parentSessionId ?? []))].filter(
      (id) => !seen.has(id),
    )

    if (ids.length === 0) break
    for (const id of ids) seen.add(id)
    level = await agentConversations()
      .find({ ...query, sessionId: { $in: ids } })
      .toArray()
    parents.push(...level)
  }

  return parents
}
