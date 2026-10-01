import type * as k8s from '@kubernetes/client-node'

export function parseCpu(s: string): number {
  if (!s) return 0
  if (s.endsWith('n')) return parseFloat(s) / 1_000_000
  if (s.endsWith('u')) return parseFloat(s) / 1_000
  if (s.endsWith('m')) return parseFloat(s)

  return parseFloat(s) * 1000
}

export function parseMemory(s: string): number {
  if (!s) return 0
  if (s.endsWith('Ki')) return parseFloat(s) * 1024
  if (s.endsWith('Mi')) return parseFloat(s) * 1024 * 1024
  if (s.endsWith('Gi')) return parseFloat(s) * 1024 ** 3
  if (s.endsWith('Ti')) return parseFloat(s) * 1024 ** 4
  if (s.endsWith('K')) return parseFloat(s) * 1000
  if (s.endsWith('M')) return parseFloat(s) * 1_000_000
  if (s.endsWith('G')) return parseFloat(s) * 1_000_000_000

  return parseFloat(s)
}

export function serviceExternalIps(svc: k8s.V1Service): string[] {
  const values = new Set<string>()

  for (const ip of svc.spec?.externalIPs ?? []) {
    if (ip) values.add(ip)
  }
  for (const ingress of svc.status?.loadBalancer?.ingress ?? []) {
    if (ingress.ip) values.add(ingress.ip)
    if (ingress.hostname) values.add(ingress.hostname)
  }
  if (svc.spec?.type === 'ExternalName' && svc.spec.externalName) {
    values.add(svc.spec.externalName)
  }
  if (values.size === 0 && svc.spec?.type === 'LoadBalancer') {
    values.add('<pending>')
  }

  return Array.from(values)
}

export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
) {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]

      await fn(item)
    }
  })

  await Promise.all(workers)
}

export function ageOf(ts: Date | string | undefined | null): string | null {
  if (!ts) return null

  return new Date(ts).toISOString()
}

export function selectorToString(selector?: k8s.V1LabelSelector): string {
  const labels = selector?.matchLabels ?? {}
  const matchLabels = Object.entries(labels).map(([k, v]) => `${k}=${v}`)
  const exprs = (selector?.matchExpressions ?? []).map((expr) => {
    const values = expr.values?.length ? ` (${expr.values.join(',')})` : ''

    return `${expr.key} ${expr.operator}${values}`
  })

  return [...matchLabels, ...exprs].join(',') || 'all pods'
}

export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b))
}
