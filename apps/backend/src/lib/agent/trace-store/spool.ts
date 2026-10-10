import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { Database } from 'bun:sqlite'

export type QueuedTrace = { id: string; sessionId: string | null; header: string; payload: string }

// SQLite applies disk backpressure at enqueue, instead of retaining an unbounded
// number of payloads/promises in RAM. One consumer holds one event at a time.
export class TraceSpool {
  private readonly database: Database
  private active: Promise<void> | undefined
  private activeWrite: Promise<void> | undefined
  private activeSession: string | null = null
  private retry: ReturnType<typeof setTimeout> | undefined
  private closed = false

  constructor(
    path: string,
    private readonly deliver: (event: QueuedTrace) => Promise<void>,
    private readonly failed: (error: unknown) => void,
  ) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.database = new Database(path, { create: true })
    chmodSync(path, 0o600)
    this.database.exec(`
      PRAGMA journal_mode = DELETE;
      PRAGMA synchronous = FULL;
      PRAGMA secure_delete = ON;
      CREATE TABLE IF NOT EXISTS queue (
        seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE,
        sessionId TEXT, header TEXT NOT NULL, payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS queue_session ON queue(sessionId);
    `)
  }

  enqueue(row: QueuedTrace): void {
    if (this.closed) throw new Error('Mongo trace spool is closed')
    this.database
      .query('INSERT INTO queue(id, sessionId, header, payload) VALUES (?, ?, ?, ?)')
      .run(row.id, row.sessionId, row.header, row.payload)
    this.start()
  }

  private start(): void {
    if (this.closed || this.active) return
    clearTimeout(this.retry)
    this.active = this.drain().finally(() => {
      this.active = undefined
      this.activeSession = null
      this.activeWrite = undefined
      if (!this.closed && this.hasPending()) {
        this.retry = setTimeout(() => {
          this.start()
        }, 1_000)
        this.retry.unref()
      }
    })
    void this.active.catch(this.failed)
  }

  private hasPending(): boolean {
    return Boolean(this.database.query('SELECT 1 FROM queue LIMIT 1').get())
  }

  private async drain(): Promise<void> {
    while (!this.closed) {
      const row = this.database
        .query<QueuedTrace, []>(
          'SELECT id, sessionId, header, payload FROM queue ORDER BY seq LIMIT 1',
        )
        .get()

      if (!row) return
      this.activeSession = row.sessionId
      this.activeWrite = this.deliver(row)
      await this.activeWrite
      if (!this.closed) this.database.query('DELETE FROM queue WHERE id = ?').run(row.id)
    }
  }

  async flush(timeoutMs: number): Promise<void> {
    const drain = async () => {
      while (!this.closed && this.hasPending()) {
        this.start()
        await this.active
      }
    }

    await withinDeadline(drain(), timeoutMs)
  }

  async purge(sessionId: string): Promise<void> {
    this.database.query('DELETE FROM queue WHERE sessionId = ?').run(sessionId)
    // Other sessions never delay a purge. Stop the turn before calling purge:
    // new writes (including from other replicas) are outside this local queue.
    if (this.activeSession === sessionId && this.activeWrite) {
      try {
        await withinDeadline(this.activeWrite, 5_000)
      } catch (error) {
        this.failed(error)
      }
    }
  }

  close(): void {
    this.closed = true
    clearTimeout(this.retry)
    this.database.close()
  }
}

export async function withinDeadline(work: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Mongo trace flush timed out'))
        }, timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
