// api.ts — typed accessors for the three OTel APIs.
//
// Calling `trace.getTracer(...)`, `metrics.getMeter(...)`, `logs.getLogger(...)`
// directly works, but funneling through this module keeps the instrumentation
// scope name + version consistent across the codebase (showing up as a single
// instrumentation scope in your tracing backend instead of dozens).

import { metrics, trace } from '@opentelemetry/api'
import { logs } from '@opentelemetry/api-logs'

import type { Attributes } from '@opentelemetry/api'

const INSTRUMENTATION_SCOPE = 'atlas-backend'
const INSTRUMENTATION_VERSION = '0.1.0'

export function getTracer(component?: string) {
  return trace.getTracer(
    component ? `${INSTRUMENTATION_SCOPE}/${component}` : INSTRUMENTATION_SCOPE,
    INSTRUMENTATION_VERSION,
  )
}

export function getMeter(component?: string) {
  return metrics.getMeter(
    component ? `${INSTRUMENTATION_SCOPE}/${component}` : INSTRUMENTATION_SCOPE,
    INSTRUMENTATION_VERSION,
  )
}

export function getLogger(component?: string) {
  return logs.getLogger(
    component ? `${INSTRUMENTATION_SCOPE}/${component}` : INSTRUMENTATION_SCOPE,
    INSTRUMENTATION_VERSION,
  )
}

// Common attribute helpers ----------------------------------------------------

// Stringify enum-ish values without breaking the OTel `AttributeValue` shape
// (which forbids `undefined` and objects). Useful when assembling attributes
// from optional config or per-call metadata.
export function cleanAttrs(
  attrs: Record<string, string | number | boolean | null | undefined>,
): Attributes {
  const out: Attributes = {}

  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue
    out[k] = v
  }

  return out
}
