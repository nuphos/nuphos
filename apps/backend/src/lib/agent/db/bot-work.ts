import { agentConversations } from './shared'

/**
 * The archive lists what Tasks would have: a Task below a Bot, through any of its
 * parents, is that Bot's work, as the sidebar decides (withChatSections), and stays
 * with the Bot. A Bot itself still lists.
 */
export function withoutBotWork(teamId: string): Record<string, unknown>[] {
  return [
    {
      $graphLookup: {
        from: agentConversations().collectionName,
        startWith: '$parentSessionId',
        connectFromField: 'parentSessionId',
        connectToField: 'sessionId',
        as: 'ancestors',
        // Bounded like any thread chain a client would draw (listedParents).
        maxDepth: 9,
        restrictSearchWithMatch: { teamId },
      },
    },
    {
      $match: {
        $or: [
          { avatar: { $exists: true } },
          {
            ancestors: {
              $not: { $elemMatch: { avatar: { $exists: true }, kind: { $ne: 'channel' } } },
            },
          },
        ],
      },
    },
    { $unset: 'ancestors' },
  ]
}
