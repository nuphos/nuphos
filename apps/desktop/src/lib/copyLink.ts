export type CopyLinkFeedback = {
  onSuccess: () => void
  onError: () => void
}

/**
 * Copies a canonical workspace link and reports exactly one outcome.
 *
 * Keeping the clipboard operation and its feedback in the same flow prevents
 * callers from showing a success message before the browser has accepted the
 * write.
 */
export async function copyLinkWithFeedback(
  href: string,
  writeText: (value: string) => Promise<void>,
  feedback: CopyLinkFeedback,
): Promise<boolean> {
  if (!href) return false

  try {
    await writeText(href)
  } catch {
    feedback.onError()

    return false
  }

  feedback.onSuccess()

  return true
}
