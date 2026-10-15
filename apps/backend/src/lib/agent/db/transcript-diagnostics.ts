import { z } from 'zod'

import { turnDiagnosticsSchema } from '../turn-diagnostics-schema'

import { redactSecrets } from '@/lib/journal/redact'

const timestamp = z.string().datetime()

// The Mongo driver stores an optional field the writer left undefined as null,
// which the schema's `.optional()` rejects; absent is what the writer meant.
function withoutNulls(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value

  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== null))
}

export function transcriptTurnDiagnostics(message: {
  index: number
  role: string
  parts: unknown[]
}) {
  if (message.role !== 'assistant') return []

  return message.parts.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const part = raw as Record<string, unknown>

    if (part.type !== 'turn-interrupted') return []
    const parsed = turnDiagnosticsSchema.safeParse(withoutNulls(part.diagnostics))
    const reason =
      typeof part.reason === 'string' && ['cancelled', 'timeout', 'error'].includes(part.reason)
        ? part.reason
        : undefined
    const messageText =
      typeof part.message === 'string'
        ? redactSecrets(part.message).redacted.slice(0, 2000)
        : undefined

    return [
      {
        message_index: message.index,
        outcome: 'interrupted',
        ...(reason ? { reason } : {}),
        ...(messageText ? { message: messageText } : {}),
        ...(typeof part.createdAt === 'string' && timestamp.safeParse(part.createdAt).success
          ? { recorded_at: part.createdAt }
          : {}),
        ...(parsed.success ? { diagnostics: parsed.data } : {}),
        ...(!parsed.success && part.diagnostics !== undefined
          ? { diagnostics_unavailable: 'invalid_record' }
          : {}),
      },
    ]
  })
}
