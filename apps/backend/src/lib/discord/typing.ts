import { discordApi } from './api'

const defaultDependencies = {
  send: (channelId: string) =>
    discordApi(`/channels/${encodeURIComponent(channelId)}/typing`, { method: 'POST' }),
  repeat: (pulse: () => void) => {
    const timer = setInterval(pulse, 8_000)

    return () => clearInterval(timer)
  },
}

/** Discord expires typing after ten seconds; keep it alive only while this turn owns the run. */
export function startDiscordTyping(
  channelId: string,
  dependencies = defaultDependencies,
): () => void {
  let pending = false
  const pulse = async () => {
    if (pending) return
    pending = true
    try {
      await dependencies.send(channelId)
    } catch {
      // Presence is best effort and must never interrupt the conversation.
    } finally {
      pending = false
    }
  }

  void pulse()

  return dependencies.repeat(() => void pulse())
}
