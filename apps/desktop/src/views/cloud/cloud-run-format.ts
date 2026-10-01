export function ingressLabel(ingress: string | null): string {
  if (!ingress) return '—'
  if (ingress === 'INGRESS_TRAFFIC_ALL') return 'All'
  if (ingress === 'INGRESS_TRAFFIC_INTERNAL_ONLY') return 'Internal'
  if (ingress === 'INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER') return 'Internal+LB'

  return ingress
}
