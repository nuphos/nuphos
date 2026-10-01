export function isPlanReadyForApproval(plan: {
  steps: { jobs: unknown[] }[]
  costSummary?: string
  riskWorstCase?: string
  riskMitigations?: string[]
}): boolean {
  const hasText = (value: string | undefined): boolean =>
    typeof value === 'string' && value.trim().length > 0

  return (
    plan.steps.length > 0 &&
    plan.steps.every((step) => step.jobs.length > 0) &&
    hasText(plan.costSummary) &&
    hasText(plan.riskWorstCase) &&
    (plan.riskMitigations?.some((item) => hasText(item)) ?? false)
  )
}
