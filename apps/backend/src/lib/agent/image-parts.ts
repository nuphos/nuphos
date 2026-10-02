/** Images remain structured in storage; only the runtime boundary renders them. */
export type PromptImage = { type: 'image'; data: string; mimeType: string; name?: string }

function imagePart(part: unknown): Record<string, unknown> | null {
  if (!part || typeof part !== 'object') return null
  const value = part as Record<string, unknown>

  return (value.type === 'file' || value.type === 'image') &&
    typeof value.mediaType === 'string' &&
    value.mediaType.startsWith('image/') &&
    typeof value.url === 'string'
    ? value
    : null
}

export function promptImages(parts: readonly unknown[]): PromptImage[] {
  return parts.flatMap((part) => {
    const value = imagePart(part)

    if (!value) return []
    const prefix = `data:${String(value.mediaType)};base64,`
    const url = value.url as string

    if (!url.startsWith(prefix) || url.length === prefix.length) return []

    return [
      {
        type: 'image' as const,
        mimeType: value.mediaType as string,
        data: url.slice(prefix.length),
        ...(typeof (value.filename ?? value.fileName) === 'string'
          ? { name: String(value.filename ?? value.fileName) }
          : {}),
      },
    ]
  })
}

/** The same image shape Desktop already stores before a turn starts. */
export function persistedImagePart(part: unknown): unknown {
  const value = imagePart(part)

  if (!value) return part

  return {
    type: 'image',
    mediaType: value.mediaType,
    url: value.url,
    fileName:
      typeof (value.filename ?? value.fileName) === 'string'
        ? (value.filename ?? value.fileName)
        : 'Image',
    ...(typeof value.attachmentId === 'string' ? { attachmentId: value.attachmentId } : {}),
  }
}
