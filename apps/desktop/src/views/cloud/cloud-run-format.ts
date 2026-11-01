import { t } from '../../i18n/index.ts'

export function ingressLabel(ingress: string | null): string {
  if (!ingress) return '—'
  if (ingress === 'INGRESS_TRAFFIC_ALL') return t('All')
  if (ingress === 'INGRESS_TRAFFIC_INTERNAL_ONLY') return t('Internal')
  if (ingress === 'INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER') return t('Internal+LB')

  return ingress
}
