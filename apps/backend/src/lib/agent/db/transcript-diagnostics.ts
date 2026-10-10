import { z } from 'zod'

import { redactSecrets } from '@/lib/journal/redact'

const text = z
  .string()
  .max(2000)
  .transform((value) => redactSecrets(value).redacted)
const timestamp = z.string().datetime()
const duration = z.number().finite().nonnegative()
// An allow-list: client-supplied transcript parts must not expand the diagnostic
// response with arbitrary objects, tool payloads, or endpoint credentials.
const diagnostics = z.object({
  streamId: z.string().max(128),
  startedAt: timestamp,
  endedAt: timestamp,
  elapsedMs: duration,
  lastProgressAt: timestamp.optional(),
  progressSilenceMs: duration.optional(),
  runtimeId: z.string().max(128).optional(),
  provider: text.optional(),
  buildSha: z.string().max(128).optional(),
  adapterVersion: text.optional(),
  source: z.enum(['backend', 'runtime', 'transport', 'cancel', 'unknown']),
  error: text.optional(),
  errorCode: z.number().finite().optional(),
  timeoutKind: z.enum(['inactivity', 'progress', 'runtime-reported-unknown']).optional(),
  timeoutMs: duration.optional(),
  lastTool: z
    .object({
      toolCallId: z.string().max(200),
      toolName: text,
      status: z.enum(['failed', 'completed', 'pending']),
    })
    .optional(),
})

export function transcriptTurnDiagnostics(message: {
  index: number
  role: string
  parts: unknown[]
}) {
  if (message.role !== 'assistant') return []

  return message.parts.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const part = raw as Record<string, unknown>

    if (part.type !== 'turn-interrupted' && part.type !== 'data-turn-diagnostics') return []
    const parsed = diagnostics.safeParse(
      part.type === 'turn-interrupted' ? part.diagnostics : part.data,
    )
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
        outcome: part.type === 'turn-interrupted' ? 'interrupted' : 'completed',
        ...(reason ? { reason } : {}),
        ...(messageText ? { message: messageText } : {}),
        ...(typeof part.createdAt === 'string' && timestamp.safeParse(part.createdAt).success
          ? { recorded_at: part.createdAt }
          : {}),
        ...(parsed.success ? { diagnostics: parsed.data } : {}),
      },
    ]
  })
}
