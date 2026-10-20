import type { Message } from '../message.ts'

/**
 * The status vocabulary every Kubernetes view shares: Argo CD's health set
 * (https://argo-cd.readthedocs.io/en/stable/operator-manual/health/). Who
 * manages an object (Helm, Argo CD, Flux, an operator, by hand) is a separate
 * label, and severity belongs to diagnoses only.
 */
export const HEALTH_STATUSES = [
  'Healthy',
  'Progressing',
  'Degraded',
  'Suspended',
  'Missing',
  'Unknown',
] as const

export type HealthStatus = (typeof HEALTH_STATUSES)[number]

export type HealthResult = {
  status: HealthStatus
  /** Why it is not Healthy, as a translatable sentence; null when nothing to add. */
  message: Message | null
}
