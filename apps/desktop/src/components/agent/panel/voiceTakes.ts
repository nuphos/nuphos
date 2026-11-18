/**
 * Which voice take's transcript may still land, and whether it is to be sent.
 * Each take gets a number; a discard, or a newer take, makes every earlier
 * number stale, so a transcript that arrives late for one is dropped. A take's
 * transcript lands at most once, so ↑ sends it exactly once.
 */
export function createTakes() {
  let current = 0
  let send = false
  let landed = false

  return {
    /** A new take starts: earlier ones are stale, and it is not yet to be sent. */
    begin(): number {
      current += 1
      send = false
      landed = false

      return current
    },
    /** Discard: whatever is recording or transcribing is dropped. */
    discard(): void {
      current += 1
    },
    /** Stop the take: with `send`, its transcript is sent once it lands. */
    stop(options?: { send?: boolean }): void {
      send = options?.send === true
    },
    /** Whether `id` is still the take whose results may show. */
    isCurrent(id: number): boolean {
      return id === current
    },
    /**
     * The transcript for take `id` lands: how to hand it over, or null when it is
     * stale, already landed, or empty.
     */
    land(id: number, text: string): { send: boolean } | null {
      if (id !== current || landed || !text.trim()) return null
      landed = true

      return { send }
    },
  }
}

export type Takes = ReturnType<typeof createTakes>
