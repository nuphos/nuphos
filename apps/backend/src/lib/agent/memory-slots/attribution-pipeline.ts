// The retention rollup as a MongoDB aggregation, mirroring `foldRetentionRow`
// and `finalizeRetentionScores` in attribution-rollup.ts.

const count = (tier: string) => ({ $sum: { $cond: [{ $eq: ['$tier', tier] }, 1, 0] } })

/** The window summed per team and memory, as `foldRetentionRow` would per row.
 * A verdict's own timestamp, else the row's, dates an application. */
const RETENTION_GROUP = {
  $group: {
    _id: { teamId: '$teamId', memoryId: '$memoryId' },
    provider: { $first: '$provider' },
    turns: { $sum: 1 },
    applied: count('applied'),
    considered: count('considered'),
    notApplicable: count('not_applicable'),
    conversations: { $addToSet: '$conversationId' },
    users: { $addToSet: '$userId' },
    corrections: {
      $sum: {
        $cond: [{ $in: ['supersede_correction', { $ifNull: ['$signals.signal', []] }] }, 1, 0],
      },
    },
    lastAppliedAt: {
      $max: {
        $cond: [
          { $eq: ['$tier', 'applied'] },
          {
            $let: {
              vars: {
                verdict: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: { $ifNull: ['$signals', []] },
                        cond: {
                          $and: [
                            { $in: ['$$this.signal', ['attribution_judge', 'human_feedback']] },
                            { $eq: ['$$this.verdict', 'applied'] },
                          ],
                        },
                      },
                    },
                    0,
                  ],
                },
              },
              in: { $ifNull: ['$$verdict.at', '$updatedAt'] },
            },
          },
          null,
        ],
      },
    },
  },
}

/** A memory's lineage, as `resolveLineages` gives it: a team memory's
 * `lineageId` (else its own id), and any other memory id as it is. */
const retentionLineage = (memories: string) => [
  {
    $addFields: {
      memoryOid: {
        $convert: { input: '$_id.memoryId', to: 'objectId', onError: null, onNull: null },
      },
    },
  },
  {
    $lookup: {
      from: memories,
      localField: 'memoryOid',
      foreignField: '_id',
      pipeline: [{ $project: { lineageId: 1 } }],
      as: 'memory',
    },
  },
  {
    $addFields: {
      lineage: {
        $let: {
          vars: { memory: { $arrayElemAt: ['$memory', 0] } },
          in: {
            $cond: [
              { $eq: [{ $type: '$$memory' }, 'missing'] },
              '$_id.memoryId',
              { $ifNull: ['$$memory.lineageId', { $toString: '$$memory._id' }] },
            ],
          },
        },
      },
    },
  },
]

const union = (field: string) => ({
  $size: { $reduce: { input: field, initialValue: [], in: { $setUnion: ['$$value', '$$this'] } } },
})

/** The rollup as one aggregation: the window folded into one score per team and
 * lineage, exactly as `computeRetentionScores` folds rows. `memories` is the team
 * memories collection, where a memory's lineage is looked up. */
export function retentionScorePipeline(
  match: Record<string, unknown>,
  memories: string,
  computedAt: Date,
) {
  return [
    { $match: match },
    RETENTION_GROUP,
    ...retentionLineage(memories),
    {
      $group: {
        _id: { teamId: '$_id.teamId', lineage: '$lineage' },
        provider: { $first: '$provider' },
        turns: { $sum: '$turns' },
        applied: { $sum: '$applied' },
        considered: { $sum: '$considered' },
        notApplicable: { $sum: '$notApplicable' },
        conversations: { $push: '$conversations' },
        users: { $push: '$users' },
        corrections: { $sum: '$corrections' },
        lastAppliedAt: { $max: '$lastAppliedAt' },
      },
    },
    {
      $project: {
        _id: 0,
        provider: 1,
        teamId: { $ifNull: ['$_id.teamId', null] },
        lineage: '$_id.lineage',
        turns: 1,
        applied: 1,
        considered: 1,
        notApplicable: 1,
        applyRate: { $divide: ['$applied', '$turns'] },
        reachConversations: union('$conversations'),
        reachUsers: union('$users'),
        corrections: 1,
        lastAppliedAt: { $cond: [{ $gt: ['$applied', 0] }, '$lastAppliedAt', null] },
        computedAt: { $literal: computedAt },
      },
    },
  ]
}
