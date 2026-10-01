import yaml from 'js-yaml'
import { ArrowUpRight } from 'lucide-react'

import { Field, Section } from './shared'

import type { DetailTarget } from './target'

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {}
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function ResourceButton({
  label,
  target,
  onNavigate,
}: {
  label: string
  target: DetailTarget
  onNavigate?: (target: DetailTarget) => void
}) {
  return (
    <button
      type="button"
      disabled={!onNavigate}
      onClick={() => onNavigate?.(target)}
      className="inline-flex items-center gap-1 font-mono text-zViolet-accent disabled:text-secondary"
    >
      {label}
      {onNavigate && <ArrowUpRight className="h-3 w-3" />}
    </button>
  )
}

export function RbacOverview({
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
  const namespace = typeof metadata.namespace === 'string' ? metadata.namespace : target.namespace
  const roleRef = record(root.roleRef)
  const roleKind = roleRef.kind === 'ClusterRole' ? 'ClusterRole' : 'Role'
  const roleName = typeof roleRef.name === 'string' ? roleRef.name : null
  const rules = Array.isArray(root.rules) ? root.rules.map(record) : []
  const subjects = Array.isArray(root.subjects) ? root.subjects.map(record) : []
  const imagePullSecrets = Array.isArray(root.imagePullSecrets)
    ? root.imagePullSecrets.map(record)
    : []

  if (target.kind === 'RoleBinding' || target.kind === 'ClusterRoleBinding') {
    return (
      <div className="space-y-5 p-6">
        <Section>
          <Field
            label="Grants role"
            value={
              roleName ? (
                <ResourceButton
                  label={`${roleKind}/${roleName}`}
                  target={{
                    kind: roleKind,
                    namespace: roleKind === 'Role' ? namespace : null,
                    name: roleName,
                  }}
                  onNavigate={onNavigate}
                />
              ) : (
                '-'
              )
            }
          />
          <Field label="Subjects" value={String(subjects.length)} />
        </Section>
        <div>
          <div className="mb-2 text-[11.5px] uppercase tracking-wider text-tertiary">Subjects</div>
          <div className="divide-y divide-zGray-800 rounded-md border border-zGray-800 bg-zGray-900">
            {subjects.map((subject, index) => {
              const kind = typeof subject.kind === 'string' ? subject.kind : 'Subject'
              const name = typeof subject.name === 'string' ? subject.name : '-'
              const subjectNamespace =
                typeof subject.namespace === 'string' ? subject.namespace : namespace

              return (
                <div key={`${kind}:${name}:${String(index)}`} className="px-4 py-3 text-[12.5px]">
                  <span className="mr-2 text-tertiary">{kind}</span>
                  {kind === 'ServiceAccount' ? (
                    <ResourceButton
                      label={`${subjectNamespace ?? '-'}/${name}`}
                      target={{ kind: 'ServiceAccount', namespace: subjectNamespace, name }}
                      onNavigate={onNavigate}
                    />
                  ) : (
                    <span className="font-mono text-main">{name}</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  if (target.kind === 'ServiceAccount') {
    return (
      <div className="space-y-5 p-6">
        <Section>
          <Field label="Namespace" value={namespace ?? '-'} />
          <Field label="Image pull secrets" value={String(imagePullSecrets.length)} />
        </Section>
        <div className="space-y-2">
          {imagePullSecrets.map((secret, index) => {
            const name = typeof secret.name === 'string' ? secret.name : null

            return name ? (
              <ResourceButton
                key={`${name}:${String(index)}`}
                label={`Secret/${name}`}
                target={{ kind: 'Secret', namespace, name }}
                onNavigate={onNavigate}
              />
            ) : null
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="mb-2 text-[11.5px] uppercase tracking-wider text-tertiary">
        Permission rules
      </div>
      <div className="divide-y divide-zGray-800 rounded-md border border-zGray-800 bg-zGray-900">
        {rules.map((rule, index) => {
          const apiGroups = strings(rule.apiGroups).map((group) => group || 'core')
          const resources = strings(rule.resources)
          const nonResourceUrls = strings(rule.nonResourceURLs)
          const resourceNames = strings(rule.resourceNames)
          const verbs = strings(rule.verbs)

          return (
            <div key={String(index)} className="grid gap-3 px-4 py-3 @2xl:grid-cols-3">
              <Field
                label="API / targets"
                value={[...apiGroups, ...resources, ...nonResourceUrls].join(' · ') || '-'}
              />
              <Field label="Verbs" value={verbs.join(', ') || '-'} />
              <Field label="Resource names" value={resourceNames.join(', ') || 'All names'} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
