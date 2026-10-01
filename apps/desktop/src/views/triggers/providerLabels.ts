import type { ManagedProviderResourcePlan } from '../../api'

export const PROVIDER_LABELS: Record<string, string> = {
  grafana: 'Grafana',
  gcp: 'GCP Monitoring',
  betterstack: 'Better Stack',
  aws: 'AWS CloudWatch',
}

export const PROVIDERS_WITH_LOGOS = new Set(['grafana', 'gcp', 'betterstack', 'aws'])

export function providerLabel(plan: ManagedProviderResourcePlan): string {
  return plan.providerLabel ?? PROVIDER_LABELS[plan.provider] ?? plan.provider
}
