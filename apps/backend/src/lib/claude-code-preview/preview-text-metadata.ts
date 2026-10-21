import type { PreviewTextMetadata } from './preview-agent-update'

export function previewTextMetadata(value: PreviewTextMetadata): PreviewTextMetadata | undefined {
  if (!value.messageId && !value.phase) return undefined

  return {
    ...(value.messageId ? { messageId: value.messageId } : {}),
    ...(value.phase ? { phase: value.phase } : {}),
  }
}
