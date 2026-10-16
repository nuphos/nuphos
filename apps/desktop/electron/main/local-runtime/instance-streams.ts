/** One bounded JSON request per stream. Closing or reconnecting discards late replies. */
export class InstanceStreams {
  private readonly streams = new Map<string, { processing: boolean }>()
  private readonly request?: (body: unknown) => Promise<unknown>
  private readonly send: (frame: object) => void
  constructor(request: InstanceStreams['request'], send: InstanceStreams['send']) {
    this.request = request
    this.send = send
  }
  has(id: string): boolean {
    return this.streams.has(id)
  }
  clear(): void {
    this.streams.clear()
  }
  close(id: string): void {
    this.streams.delete(id)
  }
  open(id: string): void {
    if (!this.request) {
      this.send({ t: 'close', s: id, reason: 'Agent instances unavailable' })

      return
    }
    this.streams.set(id, { processing: false })
    this.send({ t: 'opened', s: id })
  }
  data(id: string, raw: string): boolean {
    const operation = this.streams.get(id)

    if (!operation) return false
    if (operation.processing) return true
    operation.processing = true
    const reply = (body: object) => {
      if (this.streams.get(id) !== operation) return
      this.streams.delete(id)
      this.send({ t: 'data', s: id, d: JSON.stringify(body) })
      this.send({ t: 'close', s: id })
    }

    void Promise.resolve()
      .then(() => {
        if (raw.length > 16_384) throw new Error('Instance request too large')

        return this.request?.(JSON.parse(raw))
      })
      .then(
        (result) => reply({ ok: true, ...(result as object) }),
        (error: unknown) =>
          reply({
            ok: false,
            error: error instanceof Error ? error.message : 'Instance request failed',
          }),
      )

    return true
  }
}
