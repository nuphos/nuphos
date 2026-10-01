import {
  assertModelIdMatchesProvider,
  parseModelProvider,
  resolveSmallModelDefault,
} from '@/lib/agent/model-id'

import { optional } from './env'

// Which hosted-Claude backend serves every model call. Resolved before the
// config object because the model-id defaults and their validation both depend
// on it. The rules themselves live in lib/agent/model-id.ts as pure functions
// so they are unit-testable without booting this module; see
// lib/agent/model-provider.ts for the wire-option differences they protect.
export const MODEL_PROVIDER = parseModelProvider(optional('AGENT_MODEL_PROVIDER'))

export const SMALL_MODEL_DEFAULT = resolveSmallModelDefault(
  MODEL_PROVIDER,
  optional('AGENT_MODEL_ID'),
  'us.anthropic.claude-haiku-4-5-20251001-v1:0',
)

export function modelId(key: string, fallback: string): string
export function modelId(key: string, fallback?: undefined): string | undefined
export function modelId(key: string, fallback?: string): string | undefined {
  const raw = optional(key) ?? fallback

  if (raw == null) return undefined
  assertModelIdMatchesProvider(MODEL_PROVIDER, key, raw)

  return raw
}
