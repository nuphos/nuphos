// Streams this device started. A pending client tool names the stream of the
// run that asked for it, so only the device that started that stream runs it:
// never a second device of the same user, and still this one after a restart.
const STORAGE_KEY = 'nuphos.agent.ownedStreams'
const MAX_OWNED_STREAMS = 200

let owned: string[] | null = null

function load(): string[] {
  if (owned) return owned
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')

    owned = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    owned = []
  }

  return owned
}

export function markOwnedAgentStream(streamId: string): void {
  const next = [...load().filter((id) => id !== streamId), streamId].slice(-MAX_OWNED_STREAMS)

  owned = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Memory still holds it; only a restart forgets.
  }
}

export function ownsAgentStream(streamId: string | undefined): boolean {
  return streamId !== undefined && load().includes(streamId)
}
