export class BoundedTtlCache<V> {
  private readonly entries = new Map<string, { expiresAt: number; value: V }>()

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  get size(): number {
    return this.entries.size
  }

  clear(): void {
    this.entries.clear()
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key)

    if (!entry) return undefined
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key)

      return undefined
    }
    // Refresh insertion order so eviction follows LRU among live entries.
    this.entries.delete(key)
    this.entries.set(key, entry)

    return entry.value
  }

  set(key: string, value: V): void {
    const now = this.now()

    for (const [candidate, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(candidate)
    }
    this.entries.delete(key)
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value

      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
    this.entries.set(key, { expiresAt: now + this.ttlMs, value })
  }
}
