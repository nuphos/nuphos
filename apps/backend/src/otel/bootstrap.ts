// bootstrap.ts — side-effect module that MUST be the very first import in
// src/index.ts. Top-level await here makes setupTelemetry() complete before
// ESM resumes evaluating index.ts's other imports, so the fetch patch lands
// before AWS / GCP / AI SDK modules get a chance to capture a reference to
// the unpatched globalThis.fetch.
//
// (ES modules evaluate sibling imports in declaration order; a top-level
// await in an earlier import blocks the next one, which is the ordering
// guarantee we rely on.)

import { setupTelemetry } from '@/otel'

const { shutdown } = await setupTelemetry()

export const shutdownTelemetry = shutdown
