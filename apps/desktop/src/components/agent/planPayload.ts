import type { MongoDatabasePlanAction } from '../../api'

export type PlanCommand = {
  command: string
  description?: string
  stdout?: string
  stderr?: string
  exitCode?: number
  executedBy?: 'agent'
}

export type PlanJob = {
  title: string
  description?: string
  commands?: PlanCommand[]
}

export type PlanStep = {
  title: string
  description?: string
  jobs: PlanJob[]
}

export type PlanCost = {
  summary: string
  oneTime?: string
  monthly?: string
  savings?: string
}

export type PlanRisk = {
  worstCase: string
  mitigations: string[]
}

export type PlanDecision = {
  label: string
  value: string
}

export type PlanPayload = {
  title: string
  /** GitHub-PR-style sequential id (#1, #2, …). Absent for legacy plans. */
  number?: number
  /** Plan-level overview / summary text (also accepted under the legacy `summary` key). */
  overview?: string
  /** Key choices for the plan as a whole (account, region, size, …) — the
   *  options the user is confirming on approve. Rendered as a KV block in the
   *  header, not as execution steps. */
  decisions?: PlanDecision[]
  /** Typed operations that have a separate, backend-enforced execution boundary. */
  databaseActions?: MongoDatabasePlanAction[]
  steps: PlanStep[]
  cost?: PlanCost
  risk?: PlanRisk
}

type FlatPlanInput = Record<string, unknown>

/**
 * Reshape the tool's flat top-level fields (costSummary / costOneTime /
 * riskWorstCase / riskMitigations / overview) into the structured PlanPayload
 * the UI renders. Bedrock Claude is more reliable with flat tool schemas, but
 * the card wants grouped Cost / Risk sections.
 */
function normalizeFlatPayload(value: unknown): PlanPayload | null {
  if (!value || typeof value !== 'object') return null
  const o = value as FlatPlanInput

  if (typeof o.title !== 'string' || o.title.length === 0) return null
  if (!Array.isArray(o.steps) || o.steps.length === 0) return null
  if (!o.steps.every(isValidStep)) return null

  const overview =
    typeof o.overview === 'string'
      ? o.overview
      : typeof o.summary === 'string'
        ? o.summary
        : undefined

  let cost: PlanCost | undefined

  if (typeof o.costSummary === 'string' && o.costSummary.length > 0) {
    cost = { summary: o.costSummary }
    if (typeof o.costOneTime === 'string') cost.oneTime = o.costOneTime
    if (typeof o.costMonthly === 'string') cost.monthly = o.costMonthly
    if (typeof o.costSavings === 'string') cost.savings = o.costSavings
  } else if (isValidCost(o.cost)) {
    // Legacy nested form, kept so older transcripts still render.
    cost = o.cost
  }

  let risk: PlanRisk | undefined

  if (
    typeof o.riskWorstCase === 'string' &&
    o.riskWorstCase.length > 0 &&
    Array.isArray(o.riskMitigations) &&
    o.riskMitigations.length > 0 &&
    o.riskMitigations.every((m) => typeof m === 'string' && m.length > 0)
  ) {
    risk = {
      worstCase: o.riskWorstCase,
      mitigations: o.riskMitigations as string[],
    }
  } else if (isValidRisk(o.risk)) {
    risk = o.risk
  }

  return {
    title: o.title,
    ...(overview !== undefined ? { overview } : {}),
    steps: o.steps as PlanStep[],
    ...(cost ? { cost } : {}),
    ...(risk ? { risk } : {}),
  }
}

export function isValidCommand(value: unknown): value is PlanCommand {
  if (!value || typeof value !== 'object') return false
  const o = value as Record<string, unknown>

  if (typeof o.command !== 'string' || o.command.length === 0) return false
  if (o.description !== undefined && typeof o.description !== 'string') return false
  if (o.stdout !== undefined && typeof o.stdout !== 'string') return false
  if (o.stderr !== undefined && typeof o.stderr !== 'string') return false
  if (o.exitCode !== undefined && typeof o.exitCode !== 'number') return false
  if (
    o.executedBy !== undefined &&
    o.executedBy !== 'agent' &&
    o.executedBy !== 'human' &&
    o.executedBy !== 'local'
  ) {
    return false
  }

  return true
}

function isValidJob(value: unknown): value is PlanJob {
  if (!value || typeof value !== 'object') return false
  const o = value as Record<string, unknown>

  if (typeof o.title !== 'string' || o.title.length === 0) return false
  if (o.description !== undefined && typeof o.description !== 'string') return false
  if (o.commands !== undefined) {
    if (!Array.isArray(o.commands)) return false
    if (!o.commands.every(isValidCommand)) return false
  }

  return true
}

function isValidStep(value: unknown): value is PlanStep {
  if (!value || typeof value !== 'object') return false
  const o = value as Record<string, unknown>

  if (typeof o.title !== 'string' || o.title.length === 0) return false
  if (o.description !== undefined && typeof o.description !== 'string') return false
  if (!Array.isArray(o.jobs) || o.jobs.length === 0) return false

  return o.jobs.every(isValidJob)
}

function isValidCost(value: unknown): value is PlanCost {
  if (!value || typeof value !== 'object') return false
  const o = value as Record<string, unknown>

  if (typeof o.summary !== 'string' || o.summary.length === 0) return false
  for (const key of ['oneTime', 'monthly', 'savings'] as const) {
    if (o[key] !== undefined && typeof o[key] !== 'string') return false
  }

  return true
}

function isValidRisk(value: unknown): value is PlanRisk {
  if (!value || typeof value !== 'object') return false
  const o = value as Record<string, unknown>

  if (typeof o.worstCase !== 'string' || o.worstCase.length === 0) return false
  if (!Array.isArray(o.mitigations) || o.mitigations.length === 0) return false

  return o.mitigations.every((m) => typeof m === 'string' && m.length > 0)
}

export function tryParsePlanPayload(value: unknown): PlanPayload | null {
  const fromFlat = normalizeFlatPayload(value)

  if (fromFlat) return fromFlat
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      const fromFlatParsed = normalizeFlatPayload(parsed)

      if (fromFlatParsed) return fromFlatParsed
    } catch {
      // fall through
    }
  }

  return null
}
