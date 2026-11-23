import { readableByFilter } from './access'
import { withoutBotWork } from './bot-work'
import { after, decodeCursor, encodeCursor } from './conversations-cursor'
import { attentionInputRequests, OPEN_INPUT_REQUEST_FILTER } from './pending-decision'
import { agentConversations, escapeRegExp } from './shared'

import type { AgentConversation } from './shared'
import type { WithId } from 'mongodb'

/** A sign-in ask holds its requester's messages this long; after that they run as usual. */
export const ASK_OPEN_MS = 60 * 60_000

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
    /** Chat question cards include initial setup; the Inbox excludes it. */
    includeOnboarding?: boolean
    /** Also return the rows' parents that another page would list. */
    withParents?: boolean
    /** Channels instead of agent conversations. Lists never mix the two. */
    channels?: boolean
    /** Only Bots: agent conversations with a face, wherever they fall in the history. */
    bots?: boolean
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
  const archivedForMe = `memberArchivedAt.${viewerUserId}`
  const sortField = CONVERSATION_SORT_FIELDS[options.sort ?? 'activity']
  const query: Record<string, unknown> = {
    teamId: options.teamId,
    // Kept apart from the search $or below, which would otherwise replace it.
    $and: [readableByFilter(viewerUserId)],
    kind: options.channels ? 'channel' : { $ne: 'channel' },
    // A Slack channel's record is the Bots' alone: no listing shows it to anyone.
    external: { $exists: false },
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
  if (options.bots) query.avatar = { $exists: true }
  if (!options.pendingDecision)
    query['metadata.trigger.id'] = options.triggerIds
      ? { $in: options.triggerIds }
      : { $exists: false }
  if (options.archived === 'only' || options.sort === 'archived') {
    query.archivedAt = { $exists: true }
  } else if (options.archived === 'exclude') {
    query.archivedAt = { $exists: false }
    query[archivedForMe] = { $exists: false }
  }
  const search = options.search?.trim()

  if (search) {
    // Substring match, not full-text: history search targets short titles /
    // first messages, where regex is predictable. The user/team index prefix
    // keeps the scan bounded to the viewer's own documents.
    const pattern = new RegExp(escapeRegExp(search), 'i')
    // "1831" or "#1831" also finds the conversation a PR with that number is
    // linked to; a Linear issue's identifier is part of its stored title.
    const number = /^#?(\d{1,9})$/.exec(search)?.[1]

    query.$or = [
      { title: pattern },
      { firstMessage: pattern },
      { 'linkedResources.title': pattern },
      ...(number ? [{ 'linkedResources.number': Number(number) }] : []),
    ]
  }
  // A row's parents are listed whether or not they wait on anything: a question
  // nests under every conversation above it, as a thread does.
  const filters = { ...query, $and: [...(query.$and as unknown[])] }

  if (options.pendingDecision)
    inboxFilter(
      query,
      viewerUserId,
      scope === 'team' ? options.ownerId : undefined,
      options.includeOnboarding,
    )

  const cursor = options.cursor ? decodeCursor(options.cursor) : undefined
  const page = (filter: Record<string, unknown>, field: string) => {
    const match = cursor ? after(filter, field, cursor) : filter

    if (options.sort !== 'archived')
      return agentConversations()
        .find(match)
        .sort({ [field]: -1, _id: -1 })
        .limit(limit + 1)
        .toArray()

    return agentConversations()
      .aggregate<WithId<AgentConversation>>([
        { $match: match },
        { $sort: { [field]: -1, _id: -1 } },
        ...withoutBotWork(options.teamId),
        { $limit: limit + 1 },
      ])
      .toArray()
  }
  // My Archived also lists the shared Tasks I archived for myself, by when I did.
  const sharedArchived = options.sort === 'archived' && scope === 'mine'
  const sortedBy = (row: AgentConversation) =>
    sharedArchived && row.userId !== viewerUserId
      ? row.memberArchivedAt?.[viewerUserId]
      : row[sortField]
  const conversations = await page(query, sortField)

  if (sharedArchived) {
    const shared = {
      ...query,
      userId: { $ne: viewerUserId },
      participantIds: viewerUserId,
      archivedAt: { $exists: false },
      [archivedForMe]: { $exists: true },
    }

    conversations.push(...(await page(shared, archivedForMe)))
    conversations.sort(
      (a, b) =>
        Number(sortedBy(b)) - Number(sortedBy(a)) ||
        (b._id.toHexString() > a._id.toHexString() ? 1 : -1),
    )
    conversations.splice(limit + 1)
  }

  const hasMore = conversations.length > limit

  if (hasMore) conversations.pop()

  const last = conversations[conversations.length - 1]
  const lastTime = last && sortedBy(last)
  const nextCursor = hasMore && last && lastTime ? encodeCursor(lastTime, last._id) : null
  const parents = options.withParents
    ? await listedParents(viewerUserId, scope, filters, conversations)
    : []

  return {
    conversations:
      options.pendingDecision && !options.includeOnboarding
        ? conversations.map((row) => ({ ...row, inputRequests: attentionInputRequests(row) }))
        : conversations,
    parents,
    nextCursor,
    hasMore,
  }
}

/**
 * The Inbox: the viewer's conversations with an open request, and any readable
 * one whose requester asked the viewer to sign its agent in.
 */
function inboxFilter(
  query: Record<string, unknown>,
  viewerUserId: string,
  ownerId?: string,
  includeOnboarding = false,
) {
  const decision: Record<string, unknown> = {
    ...OPEN_INPUT_REQUEST_FILTER,
    ...(includeOnboarding
      ? {}
      : {
          $or: [
            { botOnboarding: { $nin: ['pending', 'active'] } },
            { inputRequests: { $elemMatch: { status: 'open', category: { $ne: 'preference' } } } },
          ],
        }),
  }

  if (query.userId !== undefined) {
    decision.userId = query.userId
    delete query.userId
  }
  // Only while the ask still holds its messages.
  // Narrowed to one member like the rest of team scope, and only about the agent it runs on now.
  const asked = {
    ...(ownerId ? { userId: ownerId } : {}),
    'signInRequest.askedUserIds': viewerUserId,
    'signInRequest.askedAt': { $gt: new Date(Date.now() - ASK_OPEN_MS) },
    $expr: { $eq: ['$signInRequest.runtimeId', '$runtimeId'] },
  }

  ;(query.$and as unknown[]).push({ $or: [decision, asked] })
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
