// GET bodies the backend tagged with an ETag, so a poll that finds nothing new
// costs a 304 instead of the whole list. Node's fetch has no HTTP cache.

import type { SignedIn } from './account-request.ts'

type Stored = { readonly etag: string; readonly text: string }

/** One GET in flight: where its body is stored, and the body it revalidates. */
export type ConditionalGet = { readonly key: string; readonly stored?: Stored }

const MAX_CHARS = 8_000_000
const MAX_ENTRY_CHARS = 2_000_000
const entries = new Map<string, Stored>()
const watched = new WeakSet<AbortSignal>()
let chars = 0

function forget(key: string): void {
  const stored = entries.get(key)

  if (!stored) return
  chars -= stored.text.length
  entries.delete(key)
}

export function clearConditionalGets(): void {
  entries.clear()
  chars = 0
}

/** Adds `If-None-Match` to a GET whose body is stored. Other methods are untouched. */
export function beginGet(
  account: SignedIn,
  method: string,
  route: string,
  headers: Record<string, string>,
): ConditionalGet | undefined {
  if (method.toUpperCase() !== 'GET') return undefined
  // A sign-out or account switch aborts the signal; stored bodies go with it.
  if (!watched.has(account.signal)) {
    watched.add(account.signal)
    account.signal.addEventListener('abort', clearConditionalGets, { once: true })
  }
  const key = `${account.api} ${account.userId ?? ''} ${route}`
  const stored = entries.get(key)

  if (stored) {
    entries.delete(key)
    entries.set(key, stored)
    headers['if-none-match'] = stored.etag
  }

  return { key, stored }
}

/** The stored body when the backend answered 304 to its tag. */
export function notModified(
  get: ConditionalGet | undefined,
  res: Response,
): { value: unknown } | null {
  if (res.status !== 304 || !get?.stored) return null

  return { value: JSON.parse(get.stored.text) }
}

/** Parses a 2xx body; a GET's is stored when it carries an ETag. */
export async function readJson<T>(get: ConditionalGet | undefined, res: Response): Promise<T> {
  if (!get) return (await res.json()) as T
  const text = await res.text()
  const etag = res.headers.get('etag')
  const value = JSON.parse(text) as T

  forget(get.key)
  if (etag && text.length <= MAX_ENTRY_CHARS) {
    entries.set(get.key, { etag, text })
    chars += text.length
    for (const key of entries.keys()) {
      if (chars <= MAX_CHARS) break
      forget(key)
    }
  }

  return value
}
