import { refundFileTransfer } from './admission'
import { loadGroup } from './service-shared'

import type { TransferScope } from './service-shared'

import { fileTransferGroups } from '@/models'

/**
 * Gives a group's hourly admission back when its file never arrived. Only for
 * callers that keep the upload URLs to themselves (devices/upload.ts): anyone
 * holding a presigned PUT could still upload after the refund, so this is not
 * exposed on a route and is not called from finalize. A ready group keeps its
 * admission, and a group is refunded at most once.
 */
export async function releaseTransfer(scope: TransferScope, groupId: string): Promise<void> {
  const group = await loadGroup(scope, groupId)

  if (!group.admission || group.status === 'ready') return
  const claimed = await fileTransferGroups().updateOne(
    {
      _id: group._id,
      status: { $ne: 'ready' },
      admission: { $exists: true },
      'admission.releasedAt': { $exists: false },
    },
    { $set: { 'admission.releasedAt': new Date() } },
  )

  if (claimed.modifiedCount === 1) await refundFileTransfer(group.admission)
}
