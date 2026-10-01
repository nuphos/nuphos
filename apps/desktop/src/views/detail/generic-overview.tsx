import { useEffect, useState } from 'react'

import { api } from '../../api'
import { useRequiredKubeContext } from '../../hooks/useKubeContext'
import { useResetOnKey } from '../useResetOnKey'

import { parseYamlSummary } from './config-secret-model'
import { ConfigMapOverview } from './configmap-overview'
import { SecretOverview } from './secret-overview'
import { RbacOverview } from './rbac-overview'
import { NetworkOverview } from './network-overview'
import { HelmReleaseOverview } from './helm-release-overview'
import { resourceYamlKey } from './target'

import type { DetailTarget } from './target'

export function GenericOverview({
  target,
  refreshKey,
  onNavigate,
}: {
  target: DetailTarget
  refreshKey: number
  onNavigate?: (target: DetailTarget) => void
}) {
  const context = useRequiredKubeContext()
  const [yaml, setYaml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    setError(null)
    const nextYaml = await api.getResourceYaml(
      context,
      target.kind,
      target.namespace,
      target.name,
      target.apiVersion,
      target.plural,
    )

    setYaml(nextYaml)
  }

  useResetOnKey(resourceYamlKey(context, target), () => {
    setYaml(null)
    setError(null)
  })

  useEffect(() => {
    let cancelled = false

    api
      .getResourceYaml(
        context,
        target.kind,
        target.namespace,
        target.name,
        target.apiVersion,
        target.plural,
      )
      .then((y) => {
        if (cancelled) return
        setError(null)
        setYaml(y)
      })
      .catch((e: unknown) => !cancelled && setError(String(e)))

    return () => {
      cancelled = true
    }
  }, [
    context,
    target.kind,
    target.namespace,
    target.name,
    target.apiVersion,
    target.plural,
    refreshKey,
  ])

  if (error) return <div className="p-6 text-error text-[13px]">{error}</div>
  if (!yaml) return <div className="p-6 text-tertiary text-[13px]">Loading…</div>

  if (target.kind === 'ConfigMap') {
    return <ConfigMapOverview target={target} yamlText={yaml} onReload={reload} />
  }
  if (target.kind === 'Secret') {
    return <SecretOverview target={target} yamlText={yaml} onReload={reload} />
  }
  if (target.kind === 'HelmRelease') {
    return <HelmReleaseOverview target={target} yamlText={yaml} />
  }
  if (
    target.kind === 'Role' ||
    target.kind === 'ClusterRole' ||
    target.kind === 'RoleBinding' ||
    target.kind === 'ClusterRoleBinding' ||
    target.kind === 'ServiceAccount'
  ) {
    return <RbacOverview target={target} yamlText={yaml} onNavigate={onNavigate} />
  }
  if (
    target.kind === 'Service' ||
    target.kind === 'Ingress' ||
    target.kind === 'EndpointSlice' ||
    target.kind === 'NetworkPolicy'
  ) {
    return <NetworkOverview target={target} yamlText={yaml} onNavigate={onNavigate} />
  }

  const summary = parseYamlSummary(yaml)

  return (
    <div className="p-6 space-y-3">
      {summary.map((s) => (
        <div key={s.label} className="bg-zGray-900 border border-zGray-800 rounded-md px-4 py-3">
          <div className="text-[11.5px] uppercase tracking-wider text-tertiary mb-1">{s.label}</div>
          <div className="text-[12.5px] text-main">{s.value}</div>
        </div>
      ))}
      <div className="text-tertiary text-[12px]">See the YAML tab for full spec.</div>
    </div>
  )
}
