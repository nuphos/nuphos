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
  }
}
