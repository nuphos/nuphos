import { describe, expect, test } from 'bun:test'

import { readablePlanStages } from './queries'

import { ACCESS_PROJECTION } from '../db/access'

describe('readablePlanStages', () => {
  test('joins the source conversation and keeps only what the viewer may read', () => {
    const [lookup, match, project] = readablePlanStages('viewer')

    expect(lookup).toMatchObject({
      $lookup: {
        from: 'agent_conversations',
        localField: 'sourceConversationId',
        foreignField: 'sessionId',
        // Without `avatar` the Bot check below never matches.
        pipeline: [{ $project: ACCESS_PROJECTION }],
      },
    })
    expect(ACCESS_PROJECTION).toMatchObject({ avatar: 1, kind: 1 })
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
                  {
                    $nor: [{ kind: { $ne: 'channel' }, avatar: { $exists: true } }],
                    $or: [{ generalAccess: { $ne: 'none' } }, { participantIds: 'viewer' }],
                  },
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
