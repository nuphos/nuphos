import { z } from 'zod'

import { dispatchLocalDownload } from '../devices/download'

import { withLabel } from './labeling'
import { onSelectedComputer } from './local-upload'

import type { LocalExecDevice, LocalExecTurn } from './local-tools'
import type { LocalDownloadRequest } from '../devices/download'

export function createLocalDownloadTool(devices: LocalExecDevice[], turn: LocalExecTurn) {
  const onComputer = onSelectedComputer(devices, turn)

  return withLabel(
    {
      description:
        'Save one file onto a conversation-selected computer, when the person asks for a file on their computer. ' +
        'First run bash skills/file-transfer/scripts/transfer-push.sh <TEAM> <file> in your workspace and pass the groupId it prints; pass fileName when the group holds several files. ' +
        'Pass an absolute target path (or ~/path) and optionally a device ID, as for local_exec. No shell expansion is performed. ' +
        'The computer fetches the file itself and returns {path, size} once it is written. If it answers file_exists, ask the person before calling again with overwrite: true. If it answers update_required, tell them to update Nuphos on that computer. ' +
        'Signed URLs and credentials stay internal. Do not use local_exec with signed URLs or third-party staging for this transfer. ' +
        'Requires an online computer with local exec allowed. The existing file-transfer limits apply.',
      execute: ({ device, ...request }: LocalDownloadRequest & { device?: string }) =>
        onComputer(
          device,
          `local_download ${JSON.stringify(request.path)}`,
          'download_failed',
          (id, actor, scope) => dispatchLocalDownload(actor, id, request, scope),
        ),
    },
    {
      groupId: z.string().min(1).max(64).describe('The groupId transfer-push.sh printed.'),
      fileName: z
        .string()
        .min(1)
        .max(512)
        .optional()
        .describe('Which file of the group to save; only when it holds more than one.'),
      path: z
        .string()
        .min(1)
        .max(4096)
        .describe('Absolute path or ~/path to write on the selected computer.'),
      overwrite: z
        .boolean()
        .optional()
        .describe('Replace an existing file. Only after the person agreed to it.'),
      device: z
        .string()
        .optional()
        .describe('Selected device ID. Omit when only one device is available.'),
    },
    { onExecuteError: () => ({ error: 'download_failed' }) },
  )
}
