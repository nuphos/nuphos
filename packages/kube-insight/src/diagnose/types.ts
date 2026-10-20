import type { KubeEvent, Pod } from '../kube.ts'
import type { Message } from '../message.ts'

export const SEVERITIES = ['critical', 'warning', 'info'] as const

export type Severity = (typeof SEVERITIES)[number]

/**
 * How a diagnosis gets fixed. `plan`, `export-patch`, `suggest-install` and
 * `request-access` are the actionable kinds later iterations wire to a change
 * plan, a patch to commit to GitOps, an install snippet, or a request for the
 * denied permission. `inspect-logs` and `edit-config` mean the fix sentence is
 * guidance the reader carries out.
 */
export const FIX_KINDS = [
  'plan',
  'export-patch',
  'suggest-install',
  'request-access',
  'inspect-logs',
  'edit-config',
] as const

export type FixKind = (typeof FIX_KINDS)[number]

export type ObjectRef = { kind: string; name: string }

/**
 * What a diagnosis rests on. Never a Secret or ConfigMap value: an `object`
 * piece names the object, nothing else.
 */
export type Evidence =
  | { type: 'field'; object: ObjectRef; path: string; value: string | null }
  | {
      type: 'event'
      object: ObjectRef
      reason: string
      message: string
      count: number
      lastSeen: string | null
    }
  | { type: 'object'; object: ObjectRef }

export type DiagnosisAction = { type: 'previous-logs'; pod: string; container: string }

export type Source = { title: string; url: string }

/** What one rule found in one pod. */
export type Finding = {
  container: string | null
  cause: Message
  why: Message
  fix: Message
  evidence: Evidence[]
  actions: DiagnosisAction[]
  /** Epoch ms of the failure, when known. */
  at: number | null
}

/** One pod, the events about it, and the time of the read. */
export type PodContext = {
  pod: Pod
  podName: string
  events: KubeEvent[]
  /** Epoch ms of the read; null disables the "recent" window. */
  now: number | null
}

export type Rule = {
  /** Stable kebab-case id; used for overrides and never renamed. */
  id: string
  severity: Severity
  fixKind: FixKind
  /** The documentation the rule rests on; at least one. */
  sources: readonly [Source, ...Source[]]
  /** Every message key the rule may emit, so translations can be checked. */
  messageKeys: readonly string[]
  check: (context: PodContext) => Finding[]
}

export type Diagnosis = {
  /** Stable within one result: rule, container and cause key. */
  id: string
  ruleId: string
  severity: Severity
  fixKind: FixKind
  container: string | null
  /** Every pod the same finding was seen in, sorted. */
  pods: string[]
  cause: Message
  why: Message
  fix: Message
  evidence: Evidence[]
  sources: readonly Source[]
  actions: DiagnosisAction[]
  lastSeen: string | null
}

export type DiagnoseInput = {
  pods: readonly Pod[]
  events: readonly KubeEvent[]
  /** The time of the read (RFC 3339 or epoch ms); omit to ignore recency. */
  now?: string | number
}

export type DiagnoseOptions = {
  rules?: readonly Rule[]
  /** Per-rule severity overrides, keyed by rule id. */
  severity?: Partial<Record<string, Severity>>
  /** Rule ids to skip. */
  disabled?: readonly string[]
}
