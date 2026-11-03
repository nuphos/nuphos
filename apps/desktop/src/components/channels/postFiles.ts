import { normalizeTransferUploadPart } from '../agent/panel/parts.ts'

import type { AgentPersistedMessage } from '../../api/agent-types'

/** The files posted with a message: a person's uploads, an agent's pushed downloads. */
export function channelFiles(message: AgentPersistedMessage) {
  const uploads = message.parts.flatMap((part) => {
    const upload = normalizeTransferUploadPart((part ?? {}) as Record<string, unknown>)

    return upload ? [upload] : []
  })
  const downloads = message.parts.flatMap((part) => {
    const { type, groupId } = (part ?? {}) as { type?: unknown; groupId?: unknown }

    return type === 'transfer-download' && typeof groupId === 'string' ? [groupId] : []
  })

  return { uploads, downloads, any: uploads.length + downloads.length > 0 }
}
