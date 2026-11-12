import { describe, expect, test } from 'bun:test'

import { readablePlanStages } from './queries'

describe('readablePlanStages', () => {
  test('joins the source conversation and keeps only what the viewer may read', () => {
    const [lookup, match, project] = readablePlanStages('viewer')

    expect(lookup).toMatchObject({
      $lookup: {
        from: 'agent_conversations',
        localField: 'sourceConversationId',
        foreignField: 'sessionId',
      },
    })
    expect(match).toEqual({
      $match: {
        $or: [
          { sourceConversationId: { $in: [null, ''] } },
          { source: { $size: 0 } },
          {
            source: {
              $elemMatch: {
                $or: [
                  { userId: 'viewer' },
                  { generalAccess: { $ne: 'none' } },
                  { participantIds: 'viewer' },
                ],
              },
            },
          },
        ],
      },
    })
    expect(project).toEqual({ $project: { source: 0 } })
  })
})
