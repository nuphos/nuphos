import { z } from 'zod'

import { redactSecrets } from '@/lib/secrets/scan'

import { turnDiagnosticsSchema } from '../turn-diagnostics-schema'

const timestamp = z.string().datetime()

// The Mongo driver stores an optional field the writer left undefined as null,
// which the schema's `.optional()` rejects; absent is what the writer meant.
function withoutNulls(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value

  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== null))
}

export async function transcriptTurnDiagnostics(message: {
  index: number
  role: string
  parts: unknown[]
}) {
  if (message.role !== 'assistant') return []
  const interrupted = message.parts.filter(
    (raw): raw is Record<string, unknown> =>
      !!raw && typeof raw === 'object' && (raw as { type?: unknown }).type === 'turn-interrupted',
  )

  return Promise.all(
    interrupted.map(async (part) => {
      const parsed = await turnDiagnosticsSchema.safeParseAsync(withoutNulls(part.diagnostics))
      const reason =
        typeof part.reason === 'string' && ['cancelled', 'timeout', 'error'].includes(part.reason)
          ? part.reason
          : undefined
      const messageText =
        typeof part.message === 'string'
          ? (await redactSecrets(part.message)).redacted.slice(0, 2000)
          : undefined

      return {
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
      }
    }),
  )
}
