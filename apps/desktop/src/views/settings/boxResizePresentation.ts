// Resizing a Box: another of the sizes its account offers, a bigger /data disk, or both.
// A running Box restarts for it, so the dialog says what that ends before anything is sent.
import { t } from '../../i18n/index.ts'

import { boxState } from './boxPresentation.ts'

import type { AgentDevice, BoxResize, BoxSizeInfo } from '../../api/device-types'

/** Whether the ⋯ menu offers Resize: a Box that exists and is not already restarting. */
export function canResize(device: AgentDevice, restarting: boolean): boolean {
  const state = boxState(device)

  return device.box !== undefined && !restarting && (state === 'running' || state === 'paused')
}

/** What the dialog sends: only what changes; null while nothing does or the disk is out of range. */
export function boxResizeRequest(
  info: BoxSizeInfo,
  vcpus: number,
  diskGiB: number | null,
): BoxResize | null {
  if (diskGiB === null || !Number.isInteger(diskGiB)) return null
  if (diskGiB < info.diskGiB || diskGiB > info.maxDiskGiB) return null
  const request = {
    ...(vcpus === info.vcpus ? {} : { vcpus }),
    ...(diskGiB > info.diskGiB ? { diskGiB } : {}),
  }

  return Object.keys(request).length > 0 ? request : null
}

/** Under the disk field: it only grows, from its size now up to what instabox makes. */
export function boxDiskHint(info: BoxSizeInfo): string {
  return t(
    'The /data disk, where its files are, only grows: from {min} up to {max} GiB. Your plan may allow less.',
    { min: String(info.diskGiB), max: String(info.maxDiskGiB) },
  )
}

/** "4 vCPU · 8 GiB, 20 GiB disk": the Box as it is now. */
export function boxCurrentSize(info: BoxSizeInfo): string {
  return t('Now {vcpus} vCPU · {memory} GiB, {disk} GiB disk', {
    vcpus: String(info.vcpus),
    memory: String(info.memMiB / 1024),
    disk: String(info.diskGiB),
  })
}

/** What the resize does to the Box, and the button that does it: a running one restarts now. */
export const BOX_RESIZE_EFFECT = {
  restart: (label: string) => ({
    note: t(
      '{label} restarts to take the new size. Its files stay, but every agent and process running on it stops. It is back in a minute or two.',
      { label },
    ),
    confirmLabel: t('Resize and restart'),
  }),
  nextStart: (label: string) => ({
    note: t(
      '{label} takes the new size the next time it starts. Its files stay; what was paused in memory does not.',
      { label },
    ),
    confirmLabel: t('Resize'),
  }),
}
