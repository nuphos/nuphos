import { plans } from './collections'
import { parsePlanNumber, scopedNumberFilter } from './scope'
import { serializePlan } from './serialize'
import { buildPlanStepDoc } from './steps'

import type { PlanScope } from './scope'
import type { PlanDTO } from './serialize'
import type { PlanStepInput } from './steps'
import type { CommandStatus, PlanDecision, PlanLifecycleStatus } from './types'

// Patch operations the agent and frontend can apply. Each field is optional so
// callers express only the change they care about.
export type UpdatePlanPatch = {
  status?: PlanLifecycleStatus
  // Bulk command status changes via dotted-path $set. Lets the agent mark
  // one command running and another done in a single call without N tool
  // round-trips.
  commandStatuses?: {
    stepIdx: number
    jobIdx: number
    cmdIdx: number
    status: CommandStatus
  }[]
  commandResults?: {
    stepIdx: number
    jobIdx: number
    cmdIdx: number
    status: CommandStatus
    stdout?: string
    stderr?: string
    exitCode?: number
    executedBy?: 'agent'
  }[]
  decisions?: PlanDecision[]
  // Content revisions. title/overview/appendStep/editStep/removeStep only
  // apply while the plan is still `proposed`: once the user approved, the
  // card content they confirmed must not change under them.
  title?: string
  overview?: string
  appendStep?: PlanStepInput
  // 0-based position to insert appendStep at; omit to append at the end.
  insertAt?: number
  editStep?: { stepIdx: number; step: PlanStepInput }
  removeStep?: { stepIdx: number }
  costSummary?: string
  costOneTime?: string
  costMonthly?: string
  costSavings?: string
  riskWorstCase?: string
  riskMitigations?: string[]
  approvedBy?: string
  rejectedBy?: string
  executionStartedAt?: Date
  executionFinishedAt?: Date
  executionError?: string
}

export async function updatePlan(
  id: string,
  patch: UpdatePlanPatch,
  scope: PlanScope,
): Promise<PlanDTO | null> {
  const planNumber = parsePlanNumber(id)

  if (planNumber == null) return null
  const now = new Date()
  const setOps: Record<string, unknown> = { updatedAt: now }
  const unsetOps: Record<string, ''> = {}
  const setOrUnset = (path: string, value: unknown) => {
    if (value === undefined) {
      unsetOps[path] = ''
    } else {
      setOps[path] = value
    }
  }

  // Path-based $set lets us mutate one deeply-nested status without rewriting
  // the whole steps tree. A dotted $set does NOT bounds-check, though: on an
  // empty/short steps array it auto-vivifies the missing parents, and numeric
  // keys into non-existent fields become object keys ({"0": …}) rather than
  // array slots — grafting a malformed, title-less phantom step. Guard every
  // target path with $exists so the whole update no-ops (returns null -> 404)
  // instead of corrupting the plan when a step/job/command isn't there yet.
  const requireCommandPaths: string[] = []

  for (const change of patch.commandStatuses ?? []) {
    const base = `steps.${String(change.stepIdx)}.jobs.${String(change.jobIdx)}.commands.${String(change.cmdIdx)}`

    setOps[`${base}.status`] = change.status
    requireCommandPaths.push(base)
  }
  for (const change of patch.commandResults ?? []) {
    const base = `steps.${String(change.stepIdx)}.jobs.${String(change.jobIdx)}.commands.${String(change.cmdIdx)}`

    setOps[`${base}.status`] = change.status
    setOrUnset(`${base}.stdout`, change.stdout)
    setOrUnset(`${base}.stderr`, change.stderr)
    setOrUnset(`${base}.exitCode`, change.exitCode)
    setOrUnset(`${base}.executedBy`, change.executedBy)
    requireCommandPaths.push(base)
  }

  if (patch.decisions !== undefined) setOps.decisions = patch.decisions
  if (patch.title !== undefined) setOps.title = patch.title
  if ('overview' in patch) setOrUnset('overview', patch.overview)
  if (patch.costSummary !== undefined) setOps.costSummary = patch.costSummary
  if ('costOneTime' in patch) setOrUnset('costOneTime', patch.costOneTime)
  if ('costMonthly' in patch) setOrUnset('costMonthly', patch.costMonthly)
  if ('costSavings' in patch) setOrUnset('costSavings', patch.costSavings)
  if (patch.riskWorstCase !== undefined) setOps.riskWorstCase = patch.riskWorstCase
  if (patch.riskMitigations !== undefined) setOps.riskMitigations = patch.riskMitigations
  if (patch.status) setOps.status = patch.status
  if (patch.executionStartedAt) setOps.executionStartedAt = patch.executionStartedAt
  if (patch.executionFinishedAt) setOps.executionFinishedAt = patch.executionFinishedAt
  if (patch.executionError !== undefined) setOps.executionError = patch.executionError
  if (patch.approvedBy) setOps.approvedBy = patch.approvedBy
  if (patch.status === 'approved' || (patch.status === 'executing' && patch.approvedBy)) {
    setOps.approvedAt = now
  }
  if (patch.status === 'rejected') {
    setOps.rejectedAt = now
    if (patch.rejectedBy) setOps.rejectedBy = patch.rejectedBy
  }

  const update: Record<string, unknown> = { $set: setOps }

  if (patch.appendStep) {
    update.$push = {
      steps:
        patch.insertAt === undefined
          ? buildPlanStepDoc(patch.appendStep)
          : { $each: [buildPlanStepDoc(patch.appendStep)], $position: patch.insertAt },
    }
  }
  const filter = scopedNumberFilter(planNumber, scope)

  for (const path of requireCommandPaths) {
    filter[path] = { $exists: true }
  }
  if (patch.editStep) {
    setOps[`steps.${String(patch.editStep.stepIdx)}`] = buildPlanStepDoc(patch.editStep.step)
    // Guard the index: an out-of-range dotted $set would extend the array
    // with null padding instead of failing.
    filter[`steps.${String(patch.editStep.stepIdx)}`] = { $exists: true }
  }
  if (patch.removeStep) {
    // Mongo can't $pull by index: $unset nulls the slot (index-guarded like
    // editStep), then a follow-up $pull below compacts the array.
    unsetOps[`steps.${String(patch.removeStep.stepIdx)}`] = ''
    filter[`steps.${String(patch.removeStep.stepIdx)}`] = { $exists: true }
  }
  if (Object.keys(unsetOps).length > 0) update.$unset = unsetOps
  const editsProposedContent =
    patch.title !== undefined ||
    'overview' in patch ||
    patch.decisions !== undefined ||
    patch.editStep !== undefined ||
    patch.removeStep !== undefined ||
    patch.appendStep !== undefined ||
    patch.costSummary !== undefined ||
    'costOneTime' in patch ||
    'costMonthly' in patch ||
    'costSavings' in patch ||
    patch.riskWorstCase !== undefined ||
    patch.riskMitigations !== undefined

  if (editsProposedContent) {
    // Content revisions only while the plan is still proposed — what the user
    // approved must not change after the fact.
    filter.status = 'proposed'
    unsetOps.approvals = ''
    unsetOps.approvedBy = ''
    unsetOps.approvedAt = ''
    update.$unset = unsetOps
  }
  if (patch.status === 'approved') {
    // Approval is a one-way proposed -> approved transition. Guarding it on
    // `proposed` makes it atomic, so two racing approvals of the same plan
    // (e.g. a double-clicked Slack "Approve & run" button) can't both win and
    // each kick off execution — only the write that still sees `proposed`
    // succeeds; the loser gets null.
    filter.status = 'proposed'
  }
  if (patch.status === 'rejected') {
    filter.status = 'proposed'
  }
  if (patch.status === 'cancelled') {
    filter.status = { $in: ['proposed', 'approved'] }
  }
  if (patch.status === 'executing') {
    // Only an already-approved (or previously-run, now-failed) plan may start
    // executing. Excluding 'proposed' atomically enforces the approval gate so a
    // patch can't approve-and-start in one step.
    filter.status = { $in: ['approved', 'failed'] }
    // Typed database actions are executable only by the backend database
    // gateway, which verifies the immutable digest and executor allow-list.
    // Generic Plan lifecycle PATCH must never bypass that boundary.
    filter['actions.type'] = { $ne: 'mongodb.change' }
  }
  if (patch.status === 'completed' || patch.status === 'failed') {
    filter['actions.type'] = { $ne: 'mongodb.change' }
  }
  const result = await plans().findOneAndUpdate(filter, update, { returnDocument: 'after' })
  let finalResult = result

  if (finalResult && patch.removeStep) {
    const compacted = await plans().findOneAndUpdate(
      scopedNumberFilter(planNumber, scope),
      { $pull: { steps: null } } as Record<string, unknown>,
      { returnDocument: 'after' },
    )

    finalResult = compacted ?? finalResult
  }
  if (!finalResult) return null
  const serialized = serializePlan(finalResult)

  // No automatic memory writes: completed plans are no longer auto-distilled; a
  // plan worth remembering goes through an explicit save_memory (scope personal
  // or team).
  return serialized
}
