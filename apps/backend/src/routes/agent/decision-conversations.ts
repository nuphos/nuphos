import { getReadableConversation } from '@/lib/agent/db'

import type { AgentConversation } from '@/lib/agent/db'
import type { InputRequest } from '@/lib/agent/db/pending-decision'

type Source = Pick<AgentConversation, 'sessionId' | 'userId' | 'teamId' | 'linkedResources'>

/** Resolve only conversation recipients this viewer may read; resource references have no face. */
export async function withDecisionConversations<T extends Record<string, unknown>>(
  row: T,
  source: Source,
  viewerId: string,
  read = getReadableConversation,
): Promise<T> {
  const requests = row.inputRequests as InputRequest[] | undefined

  if (!requests?.some((request) => request.about?.length)) return row
  const linked = new Set(source.linkedResources?.map(({ id }) => id))
  const targets = new Map<string, { sessionId: string; title: string }>()
  const refs = new Set(requests.flatMap((request) => request.about ?? []))

  for (const ref of refs) {
    if (linked.has(ref) || ref === source.sessionId) continue
    const target = await read(ref, viewerId, source.teamId)

    if (
      target &&
      target.userId === source.userId &&
      target.teamId === source.teamId &&
      target.kind !== 'channel'
    )
      targets.set(ref, { sessionId: target.sessionId, title: target.title })
  }

  return {
    ...row,
    inputRequests: requests.map((request) => ({
      ...request,
      aboutConversations: [...new Set(request.about ?? [])].flatMap((ref) => {
        const target = targets.get(ref)

        return target ? [target] : []
      }),
    })),
  }
}
