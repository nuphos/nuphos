// Kubernetes object names used here must be valid DNS-1123 labels (<= 63 chars).
export const DNS_1123_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

export function defaultJobName(cronJobName: string): string {
  const suffix = Date.now().toString(36).slice(-6)
  // Job names must be DNS-1123 labels (<= 63 chars). Reserve room for the suffix.
  const base = cronJobName.slice(0, 63 - suffix.length - 1)

  return `${base}-${suffix}`
}
