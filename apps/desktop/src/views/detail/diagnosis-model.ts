import { renderMessage, translate } from '../../lib/kube-insight.ts'

import type { Diagnosis, Evidence, Locale, ResourceDiagnosis } from '../../lib/kube-insight.ts'

// View model for the diagnosis card: everything the card shows, already
// translated, so the component only lays it out.

export type EvidenceRow = { label: string; detail: string }

export type DiagnosisView = {
  id: string
  severity: Diagnosis['severity']
  severityLabel: string
  fixKindLabel: string
  cause: string
  why: string
  fix: string
  pods: string[]
  evidence: EvidenceRow[]
  sources: Diagnosis['sources']
  previousLogs: { pod: string; container: string } | null
}

/**
 * The card speaks the app's UI language, not the OS's. Desktop is English
 * only; switch this when the app gains a language setting.
 */
export const APP_UI_LOCALE: Locale = 'en'

export function evidenceRow(evidence: Evidence): EvidenceRow {
  const object = `${evidence.object.kind}/${evidence.object.name}`

  switch (evidence.type) {
    case 'field':
      return {
        label: `${object} ${evidence.path}`,
        detail: evidence.value ?? '',
      }
    case 'event':
      return {
        label: `${object} event ${evidence.reason} ×${String(evidence.count)}`,
        detail: evidence.message,
      }
    case 'object':
      return { label: object, detail: '' }
  }
}

export function diagnosisView(locale: Locale, d: Diagnosis): DiagnosisView {
  // previous-logs is the only action kind so far.
  const logs = d.actions.at(0)

  return {
    id: d.id,
    severity: d.severity,
    severityLabel: translate(locale, `severity.${d.severity}`),
    fixKindLabel: translate(locale, `fixKind.${d.fixKind}`),
    cause: renderMessage(locale, d.cause),
    why: renderMessage(locale, d.why),
    fix: renderMessage(locale, d.fix),
    pods: d.pods,
    evidence: d.evidence.map(evidenceRow),
    sources: d.sources,
    previousLogs: logs ? { pod: logs.pod, container: logs.container } : null,
  }
}

/** The card is hidden while loading, on error, and whenever nothing is wrong. */
export function visibleDiagnoses(result: ResourceDiagnosis | null): Diagnosis[] {
  return result?.diagnoses ?? []
}
