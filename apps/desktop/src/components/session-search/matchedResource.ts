import { searchMatch } from '../../lib/searchMatch.ts'

import type { AgentConversation } from '../../api/agent-types'
import type { SessionResource } from '../../api/session-resource-types'

/**
 * The linked PR or issue a query found a conversation by, as the row's second
 * line: "1831" or "#1831" names a PR's number, any other text its title.
 */
export function matchedResourceLabel(resources: SessionResource[] | undefined, query: string) {
  const number = /^#?(\d{1,9})$/.exec(query.trim())?.[1]
  const resource = resources?.find(
    (item) =>
      (number !== undefined && item.number === Number(number)) || searchMatch(item.title, query),
  )

  if (!resource) return

  return resource.number === undefined
    ? resource.title
    : `#${String(resource.number)} ${resource.title}`
}

/**
 * A result's second line: nothing when its title matched, the first message
 * when that is what matched, otherwise the linked PR or issue it was found by.
 */
export function searchPreview(
  conversation: Pick<AgentConversation, 'title' | 'firstMessage' | 'linkedResources'>,
  query: string,
) {
  if (conversation.title && searchMatch(conversation.title, query)) return
  if (conversation.title && searchMatch(conversation.firstMessage, query))
    return conversation.firstMessage

  return matchedResourceLabel(conversation.linkedResources, query)
}
