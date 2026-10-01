const transcriptWriteQueues = new Map<string, Promise<void>>()

export async function withTranscriptWriteLock<T>(
  sessionId: string,
  userId: string,
  write: () => Promise<T>,
): Promise<T> {
  const key = `${userId}:${sessionId}`
  const previous = transcriptWriteQueues.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const queued = previous.catch(() => null).then(() => gate)

  transcriptWriteQueues.set(key, queued)
  await previous.catch(() => null)
  try {
    return await write()
  } finally {
    release()
    if (transcriptWriteQueues.get(key) === queued) transcriptWriteQueues.delete(key)
  }
}
