import { isoOf, timeOf } from '../kube.ts'

import { BUILTIN_RULES } from './registry.ts'
import { SEVERITIES } from './types.ts'

import type { DiagnoseInput, DiagnoseOptions, Diagnosis, Finding, Rule } from './types.ts'
import type { KubeEvent, Pod } from '../kube.ts'

/** Evidence pieces kept per diagnosis once findings from many pods merge. */
const EVIDENCE_LIMIT = 6

function nowOf(now: DiagnoseInput['now']): number | null {
  if (now == null) return null

  return typeof now === 'number' ? now : timeOf(now)
}

function eventsByPod(events: readonly KubeEvent[]): Map<string, KubeEvent[]> {
  const byPod = new Map<string, KubeEvent[]>()

  for (const event of events) {
    const { kind, name } = event.involvedObject

    if (kind !== 'Pod' || !name) continue
    const list = byPod.get(name) ?? []

    list.push(event)
    byPod.set(name, list)
  }

  return byPod
}

function toDiagnosis(
  rule: Rule,
  finding: Finding,
  pod: string,
  options: DiagnoseOptions,
): Diagnosis {
  return {
    id: `${rule.id}:${finding.container ?? ''}:${finding.cause.key}`,
    ruleId: rule.id,
    severity: options.severity?.[rule.id] ?? rule.severity,
    fixKind: rule.fixKind,
    container: finding.container,
    pods: [pod],
    cause: finding.cause,
    why: finding.why,
    fix: finding.fix,
    evidence: finding.evidence,
    sources: rule.sources,
    actions: finding.actions,
    lastSeen: finding.at == null ? null : isoOf(new Date(finding.at)),
  }
}

/** Folds the same finding seen in another pod into an existing diagnosis. */
function merge(into: Diagnosis, next: Diagnosis): void {
  if (!into.pods.includes(next.pods[0])) into.pods.push(next.pods[0])
  // Keep the most recent occurrence's sentences: its counts are the current ones.
  if ((next.lastSeen ?? '') > (into.lastSeen ?? '')) {
    into.cause = next.cause
    into.why = next.why
    into.fix = next.fix
    into.lastSeen = next.lastSeen
    into.actions = next.actions
  }
  for (const piece of next.evidence) {
    if (into.evidence.length >= EVIDENCE_LIMIT) break
    into.evidence.push(piece)
  }
}

function severityRank(diagnosis: Diagnosis): number {
  return SEVERITIES.indexOf(diagnosis.severity)
}

/**
 * Why the given pods fail: every rule over every pod and the events about it,
 * with the same finding in several pods of one workload folded into one
 * diagnosis. Pure: the same snapshot always yields the same result.
 */
export function diagnose(input: DiagnoseInput, options: DiagnoseOptions = {}): Diagnosis[] {
  const now = nowOf(input.now)
  const disabled = new Set(options.disabled ?? [])
  const rules = (options.rules ?? BUILTIN_RULES).filter((rule) => !disabled.has(rule.id))
  const byPod = eventsByPod(input.events)
  const found = new Map<string, Diagnosis>()
  const pods = [...input.pods].sort((a: Pod, b: Pod) =>
    (a.metadata?.name ?? '').localeCompare(b.metadata?.name ?? ''),
  )

  for (const pod of pods) {
    const podName = pod.metadata?.name ?? ''
    const context = { pod, podName, events: byPod.get(podName) ?? [], now }

    for (const rule of rules) {
      for (const finding of rule.check(context)) {
        const diagnosis = toDiagnosis(rule, finding, podName, options)
        const existing = found.get(diagnosis.id)

        if (existing) merge(existing, diagnosis)
        else found.set(diagnosis.id, diagnosis)
      }
    }
  }
  const order = new Map(rules.map((rule, index) => [rule.id, index]))

  return [...found.values()]
    .map((d) => ({ ...d, pods: [...d.pods].sort((a, b) => a.localeCompare(b)) }))
    .sort(
      (a, b) =>
        severityRank(a) - severityRank(b) ||
        (order.get(a.ruleId) ?? 0) - (order.get(b.ruleId) ?? 0) ||
        a.id.localeCompare(b.id),
    )
}
