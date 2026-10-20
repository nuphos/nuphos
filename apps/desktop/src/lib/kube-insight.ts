// The desktop's single entry into packages/kube-insight. Both the renderer and
// the electron main process import the package through this file, so moving
// or publishing the package later changes one path.
import type { Diagnosis, HealthResult } from '../../../../packages/kube-insight/src/index.ts'

export * from '../../../../packages/kube-insight/src/index.ts'

/** Kinds the detail page diagnoses; the main process reads each one's pods. */
export const DIAGNOSABLE_KINDS = ['Pod', 'Deployment', 'StatefulSet', 'DaemonSet', 'Job'] as const

export type DiagnosableKind = (typeof DIAGNOSABLE_KINDS)[number]

export function isDiagnosableKind(kind: string): kind is DiagnosableKind {
  return (DIAGNOSABLE_KINDS as readonly string[]).includes(kind)
}

/** What `k8s:getResourceDiagnosis` returns: plain JSON, safe across IPC. */
export type ResourceDiagnosis = {
  health: HealthResult
  diagnoses: Diagnosis[]
}
