export type TextStreamBuffer = {
  text: string
  timer: number | null
  onDrained?: () => void
}

export function registerTextDrainCompletion(
  entry: TextStreamBuffer | undefined,
  onDrained: () => void,
): boolean {
  if (!entry?.text) return false
  entry.onDrained ??= onDrained

  return true
}
