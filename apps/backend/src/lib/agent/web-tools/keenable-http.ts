const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

export const PUBLISHED_AFTER_HINT =
  'published_after must be a date, timestamp, or relative offset (e.g. 7d)'

export class KeenableApiError extends Error {
  readonly operation: 'search' | 'fetch'

  constructor(operation: 'search' | 'fetch', message: string) {
    super(message)
    this.name = 'KeenableApiError'
    this.operation = operation
  }
}

function providerRejectionMessage(operation: 'search' | 'fetch', status: number): string {
  const noun = operation === 'search' ? 'search' : 'fetch'

  return `The web ${noun} provider rejected the request (${String(status)})`
}

function invalidResponseMessage(operation: 'search' | 'fetch'): string {
  const noun = operation === 'search' ? 'search' : 'fetch'

  return `The web ${noun} provider returned an invalid response`
}

export function oversizedResponseMessage(operation: 'search' | 'fetch'): string {
  const noun = operation === 'search' ? 'search' : 'fetch'

  return `The web ${noun} provider returned an oversized response`
}

function logProviderDetail(operation: 'search' | 'fetch', status: number, detail: string): void {
  const snippet = detail.trim().slice(0, 500)

  console.warn(`Keenable ${operation} HTTP ${String(status)}: ${snippet || '(empty body)'}`)
}

function raiseApiError(
  operation: 'search' | 'fetch',
  status: number,
  bodyText: string,
  hadPublishedAfter = false,
): never {
  logProviderDetail(operation, status, bodyText)
  if (operation === 'search' && status === 400 && hadPublishedAfter) {
    throw new KeenableApiError(operation, PUBLISHED_AFTER_HINT)
  }

  throw new KeenableApiError(operation, providerRejectionMessage(operation, status))
}

async function readLimitedText(
  response: Response,
  operation: 'search' | 'fetch',
  maxBytes: number,
): Promise<string> {
  const lengthHeader = response.headers.get('content-length')

  if (lengthHeader !== null) {
    const length = Number(lengthHeader)

    if (Number.isFinite(length) && length > maxBytes) {
      throw new KeenableApiError(operation, oversizedResponseMessage(operation))
    }
  }

  const stream = response.body

  if (!stream) return response.text()

  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()

      if (done) break
      if (!(value instanceof Uint8Array)) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()

        throw new KeenableApiError(operation, oversizedResponseMessage(operation))
      }

      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const merged = new Uint8Array(total)
  let offset = 0

  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }

  return new TextDecoder().decode(merged)
}

export async function readKeenablePayload(
  response: Response,
  operation: 'search' | 'fetch',
  options?: { hadPublishedAfter?: boolean },
): Promise<unknown> {
  const text = await readLimitedText(response, operation, MAX_RESPONSE_BYTES)

  if (!response.ok) raiseApiError(operation, response.status, text, options?.hadPublishedAfter)

  try {
    return JSON.parse(text) as unknown
  } catch {
    logProviderDetail(operation, response.status, text)

    throw new KeenableApiError(operation, invalidResponseMessage(operation))
  }
}
