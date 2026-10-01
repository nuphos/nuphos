import type { KubeClient, KubeResource } from './kube-client'

type VolumeIdentity = { claimUid?: string; volumeName?: string; volumeUid?: string }

/** A claim and the disk behind it, checked against what an earlier pass recorded. */
export async function inspectClaim(
  kube: Required<Pick<KubeClient, 'getResource'>>,
  claim: KubeResource,
  recorded: VolumeIdentity,
) {
  const pvc = await kube.getResource(claim)

  if (pvc && !pvc.spec?.volumeName)
    throw new Error('Waiting for the runtime volume to finish binding.')
  if (pvc && recorded.claimUid && recorded.claimUid !== pvc.metadata.uid)
    throw new Error('Runtime claim identity changed.')
  const volumeName = recorded.volumeName ?? pvc?.spec?.volumeName
  const volume = volumeName
    ? await kube.getResource({
        apiVersion: 'v1',
        kind: 'PersistentVolume',
        metadata: { name: volumeName, namespace: '' },
      })
    : null

  if (volume && recorded.volumeUid && recorded.volumeUid !== volume.metadata.uid)
    throw new Error('Runtime volume identity changed.')
  // Never delete a Retain volume's claim and silently strand its backing disk.
  if (
    volume &&
    (volume.spec?.persistentVolumeReclaimPolicy !== 'Delete' ||
      (pvc && volume.spec.claimRef?.uid !== pvc.metadata.uid))
  )
    throw new Error(
      'The runtime volume must have a matching claim and Delete reclaim policy before deletion.',
    )

  return {
    pvc,
    volume,
    identity: {
      ...(pvc ? { claimUid: pvc.metadata.uid } : {}),
      ...(volumeName ? { volumeName } : {}),
      ...(volume ? { volumeUid: volume.metadata.uid } : {}),
    },
  }
}

/** Deletes the claim, then waits until its disk is gone too. True while that is pending. */
export async function removeClaim(
  kube: KubeClient,
  claim: KubeResource,
  { pvc, volume }: Awaited<ReturnType<typeof inspectClaim>>,
): Promise<boolean> {
  if (pvc) {
    if (!pvc.metadata.deletionTimestamp) await kube.delete(claim, pvc.metadata.uid)

    return true
  }

  return Boolean(volume)
}
