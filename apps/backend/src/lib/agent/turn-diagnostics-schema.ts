import { z } from 'zod'

import { redactSecrets } from '@/lib/journal/redact'

const bounded = (max: number) => z.string().transform((value) => value.slice(0, max))
// Best-effort secret masking, not anonymization of hosts, paths or commands.
const text = z.string().transform((value) => redactSecrets(value).redacted.slice(0, 2000))
const timestamp = z.string().datetime()
const duration = z.number().finite().nonnegative()

// An allow-list: client-supplied transcript parts must not expand the diagnostic
// response with arbitrary objects, tool payloads, or endpoint credentials.
export const turnDiagnosticsSchema = z.object({
  streamId: bounded(128),
  startedAt: timestamp,
  endedAt: timestamp,
  elapsedMs: duration,
  // Text, thought and tool callbacks only; not the watchdog progress clock.
  lastOutputAt: timestamp.optional(),
  outputSilenceMs: duration.optional(),
  runtimeId: bounded(128).optional(),
  buildSha: bounded(128).optional(),
  adapterVersion: text.optional(),
  source: z.enum(['backend', 'runtime', 'transport', 'abort', 'unknown']),
  error: text.optional(),
  errorCode: z.number().finite().optional(),
  timeoutKind: z
    .enum(['inactivity', 'progress', 'call-deadline', 'runtime-reported-unknown'])
    .optional(),
  timeoutMs: duration.optional(),
  lastTool: z
    .object({
      toolCallId: bounded(200),
      toolName: text,
      status: z.enum(['failed', 'completed', 'pending']),
    })
    .optional(),
})

export type TurnDiagnostics = z.infer<typeof turnDiagnosticsSchema>
