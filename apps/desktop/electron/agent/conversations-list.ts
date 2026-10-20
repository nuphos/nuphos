import { callJson } from './http'

import type { ConversationsPage } from './types'

export type ConversationsScope = 'mine' | 'team' | 'shared'
export type ConversationsArchivedFilter = 'exclude' | 'only'
export type ConversationsSort = 'activity' | 'created' | 'archived'

export type ListConversationsOptions = {
  cursor?: string
  limit?: number
  // Defaults to 'mine' backend-side — the viewer's own chats in this team.
  scope?: ConversationsScope
  /** Narrow team scope to one member's conversations. */
  ownerId?: string
  /**
   * A Trigger's run history. Omitted lists Chats, which excludes trigger runs entirely — the two
   * are opposite listings, so this is never a refinement of the default. Several ids list a
   * Watch group's partition triggers together.
   */
  triggerIds?: string[]
  search?: string
  // Omitted = archived conversations list too (history); 'exclude' = sidebar.
  archived?: ConversationsArchivedFilter
  sort?: ConversationsSort
  /** The Inbox: only conversations waiting on the owner's decision, trigger runs included. */
  pendingDecision?: boolean
}

/**
 * teamId leads and is required — the backend rejects a listing without one, so
 * a caller that can't name the team has no question to ask.
 */
export async function listConversations(
  teamId: string,
  options?: ListConversationsOptions,
): Promise<ConversationsPage> {
  const params = new URLSearchParams({ teamId })

  if (options?.cursor) params.set('cursor', options.cursor)
  if (options?.limit) params.set('limit', String(options.limit))
  if (options?.scope) params.set('scope', options.scope)
  if (options?.ownerId) params.set('ownerId', options.ownerId)
  // Sent even when empty: an empty list is a Watch group with no partitions
  // yet, and dropping the parameter would answer with Chats instead.
  if (options?.triggerIds) params.set('triggerId', options.triggerIds.join(','))
  if (options?.search) params.set('search', options.search)
  if (options?.archived) params.set('archived', options.archived)
  if (options?.sort) params.set('sort', options.sort)
  if (options?.pendingDecision) params.set('pendingDecision', 'true')

  const route = `/agent/conversations?${String(params)}`

  return callJson<ConversationsPage>('GET', route, undefined, 12_000)
}
