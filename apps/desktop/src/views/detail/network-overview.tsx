import yaml from 'js-yaml'
import { ArrowUpRight } from 'lucide-react'

import { ServiceOverview } from './network-service-overview'
import { Field, Section } from './shared'

import type { DetailTarget } from './target'

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {}
}

function records(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown, fallback = '-'): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback
}

function compact(value: unknown): string {
  if (!value || typeof value !== 'object') return '-'

  return JSON.stringify(value)
}

function arraySummary(value: unknown, empty: string): string {
  return Array.isArray(value) && value.length > 0 ? compact(value) : empty
}

function ResourceButton({
  kind,
  namespace,
  name,
  onNavigate,
}: {
  kind: DetailTarget['kind']
  namespace: string | null
  name: string
  onNavigate?: (target: DetailTarget) => void
}) {
  return (
    <button
      type="button"
      disabled={!onNavigate}
      onClick={() => onNavigate?.({ kind, namespace, name })}
      className="inline-flex items-center gap-1 font-mono text-zViolet-accent disabled:text-secondary"
    >
      {kind}/{name}
      {onNavigate && <ArrowUpRight className="h-3 w-3" />}
    </button>
  )
}

function Rows({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y divide-zGray-800 rounded-md border border-zGray-800">{children}</div>
  )
}

export function NetworkOverview({
  target,
  yamlText,
  onNavigate,
}: {
  target: DetailTarget
  yamlText: string
  onNavigate?: (target: DetailTarget) => void
}) {
  const root = record(yaml.load(yamlText))
  const metadata = record(root.metadata)
  const spec = record(root.spec)
  const namespace = typeof metadata.namespace === 'string' ? metadata.namespace : target.namespace

  if (target.kind === 'Service') {
    return (
      <ServiceOverview target={target} spec={spec} namespace={namespace} onNavigate={onNavigate} />
    )
  }

  if (target.kind === 'Ingress') {
    const rules = records(spec.rules)
    const ruleBackends = rules.flatMap((rule) =>
      records(record(rule.http).paths).map((path) => ({
        host: text(rule.host, '*'),
        path: text(path.path, '/'),
        backend: record(record(path.backend).service),
      })),
    )
    const defaultBackend = record(record(spec.defaultBackend).service)
    const backends = [
      ...(typeof defaultBackend.name === 'string'
        ? [{ host: '*', path: '(default)', backend: defaultBackend }]
        : []),
      ...ruleBackends,
    ]
    const tlsSecrets = records(spec.tls)
      .map((tls) => text(tls.secretName, ''))
      .filter(Boolean)

    return (
      <div className="space-y-5 p-6">
        <Section>
          <Field label="Ingress class" value={text(spec.ingressClassName)} />
          <Field label="Rules" value={String(backends.length)} />
          <Field
            label="TLS secrets"
            value={
              tlsSecrets.length
                ? tlsSecrets.map((name) => (
                    <ResourceButton
                      key={name}
                      kind="Secret"
                      namespace={namespace}
                      name={name}
                      onNavigate={onNavigate}
                    />
                  ))
                : '-'
            }
          />
        </Section>
        <Rows>
          {backends.map(({ host, path, backend }, index) => {
            const serviceName = text(backend.name, '')
            const port = record(backend.port)

            return (
              <div
                key={`${host}:${path}:${String(index)}`}
                className="grid grid-cols-3 gap-3 px-4 py-3"
              >
                <Field label="Route" value={`${host}${path}`} />
                <Field
                  label="Service"
                  value={
                    serviceName ? (
                      <ResourceButton
                        kind="Service"
                        namespace={namespace}
                        name={serviceName}
                        onNavigate={onNavigate}
                      />
                    ) : (
                      '-'
                    )
                  }
                />
                <Field label="Service port" value={text(port.name ?? port.number)} />
              </div>
            )
          })}
        </Rows>
      </div>
    )
  }

  if (target.kind === 'EndpointSlice') {
    const serviceName = text(record(metadata.labels)['kubernetes.io/service-name'], '')

    return (
      <div className="space-y-5 p-6">
        <Section>
          <Field label="Address type" value={text(root.addressType)} />
          <Field
            label="Service"
            value={
              serviceName ? (
                <ResourceButton
                  kind="Service"
                  namespace={namespace}
                  name={serviceName}
                  onNavigate={onNavigate}
                />
              ) : (
                '-'
              )
            }
          />
          <Field label="Ports" value={records(root.ports).map(compact).join(', ') || '-'} />
        </Section>
        <Rows>
          {records(root.endpoints).map((endpoint, index) => {
            const targetRef = record(endpoint.targetRef)
            const podName = targetRef.kind === 'Pod' ? text(targetRef.name, '') : ''

            return (
              <div key={String(index)} className="grid grid-cols-3 gap-3 px-4 py-3">
                <Field
                  label="Addresses"
                  value={Array.isArray(endpoint.addresses) ? endpoint.addresses.join(', ') : '-'}
                />
                <Field label="Conditions" value={compact(endpoint.conditions)} />
                <Field
                  label="Target"
                  value={
                    podName ? (
                      <ResourceButton
                        kind="Pod"
                        namespace={namespace}
                        name={podName}
                        onNavigate={onNavigate}
                      />
                    ) : (
                      text(targetRef.name)
                    )
                  }
                />
              </div>
            )
          })}
        </Rows>
      </div>
    )
  }

  const ingress = records(spec.ingress)
  const egress = records(spec.egress)

  return (
    <div className="space-y-5 p-6">
      <Section>
        <Field label="Pod selector" value={compact(spec.podSelector)} />
        <Field
          label="Policy types"
          value={Array.isArray(spec.policyTypes) ? spec.policyTypes.join(', ') : '-'}
        />
      </Section>
      {[
        ['Ingress', ingress],
        ['Egress', egress],
      ].map(([label, rules]) => (
        <div key={label as string}>
          <div className="mb-2 text-[11.5px] uppercase tracking-wider text-tertiary">
            {label as string}
          </div>
          <Rows>
            {(rules as UnknownRecord[]).length > 0 ? (
              (rules as UnknownRecord[]).map((rule, index) => (
                <div key={String(index)} className="grid grid-cols-2 gap-3 px-4 py-3">
                  <Field label="Peers" value={arraySummary(rule.from ?? rule.to, 'All peers')} />
                  <Field label="Ports" value={arraySummary(rule.ports, 'All ports')} />
                </div>
              ))
            ) : (
              <div className="px-4 py-3 text-[12.5px] text-secondary">
                No allow rules — traffic in this direction is denied.
              </div>
            )}
          </Rows>
        </div>
      ))}
    </div>
  )
}
