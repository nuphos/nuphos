import { agentTriggerGroups, triggerGroupMemberRuns } from '../trigger-group-db'

import type { ObjectId } from 'mongodb'

export async function removeTriggerFromWatchGroups(
  triggerId: ObjectId,
  scope: {
    ownerUserId?: string
    teamId?: string
  },
  knownGroup?: {
    groupId: ObjectId
    memberKeys: string[]
  },
): Promise<void> {
  const ownership = scope.teamId
    ? { teamId: scope.teamId }
    : { userId: scope.ownerUserId, teamId: { $exists: false } }
  const groups = knownGroup
    ? await agentTriggerGroups()
        .find({
          _id: knownGroup.groupId,
          ...ownership,
          'partitions.triggerId': triggerId,
        })
        .toArray()
    : await agentTriggerGroups()
        .find({
          ...ownership,
          'partitions.triggerId': triggerId,
        })
        .toArray()

  for (const group of groups) {
    if (!group._id) continue
    const partition = group.partitions.find((item) => item.triggerId.equals(triggerId))
    const memberKeys = knownGroup?.memberKeys ?? partition?.memberKeys ?? []

    await agentTriggerGroups().updateOne(
      {
        _id: group._id,
        'partitions.triggerId': triggerId,
      },
      {
        $pull: {
          partitions: { triggerId },
          ...(memberKeys.length > 0 ? { members: { key: { $in: memberKeys } } } : {}),
        },
        $set: { updatedAt: new Date() },
      },
    )
    if (memberKeys.length > 0) {
      await triggerGroupMemberRuns().deleteMany({
        groupId: group._id,
        memberKey: { $in: memberKeys },
      })
    }
    const remaining = await agentTriggerGroups().findOne(
      { _id: group._id },
      { projection: { partitions: 1 } },
    )

    if (remaining && remaining.partitions.length === 0) {
      await agentTriggerGroups().deleteOne({ _id: group._id })
    }
  }
}
