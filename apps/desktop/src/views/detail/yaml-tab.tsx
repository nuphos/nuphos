import yaml from 'js-yaml'
import { AlertTriangle, Eye, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { YamlEditor } from '../../components/YamlEditor'
import { useRequiredKubeContext } from '../../hooks/useKubeContext'
import { useResetOnKey } from '../useResetOnKey'

import { detailTargetKey, resourceYamlKey } from './target'
import { mergeRefreshedYaml } from './yaml-refresh'

import type { K8sYamlObject } from './config-secret-model'
import type { DetailTarget } from './target'
import type { YamlEditorHandle } from '../../components/YamlEditor'

type ResourceYamlIdentity = {
  apiVersion: string
  kind: string
  name: string
  namespace: string | null
}

export function YamlTab({ target, refreshKey }: { target: DetailTarget; refreshKey: number }) {
  const context = useRequiredKubeContext()
  const [yamlText, setYamlText] = useState<string | null>(null)
  const [draftYaml, setDraftYaml] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showSecretValues, setShowSecretValues] = useState(false)
  const targetRef = useRef(target)
  const yamlTextRef = useRef(yamlText)
  const draftYamlRef = useRef(draftYaml)

  useEffect(() => {
    targetRef.current = target
    yamlTextRef.current = yamlText
    draftYamlRef.current = draftYaml
  })
  const editorRef = useRef<YamlEditorHandle | null>(null)

  useResetOnKey(resourceYamlKey(context, target), () => {
    setYamlText(null)
    setDraftYaml('')
    setError(null)
    setActionError(null)
    setSaving(false)
    setShowSecretValues(false)
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
        const refreshed = mergeRefreshedYaml(yamlTextRef.current, draftYamlRef.current, y)

        setError(null)
        setYamlText(refreshed.yamlText)
        setDraftYaml(refreshed.draftYaml)
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
  if (!yamlText) return <div className="p-6 text-tertiary text-[13px]">Loading…</div>

  const secretRedacted = target.kind === 'Secret' && !showSecretValues
  const helmReleaseReadOnly = target.kind === 'HelmRelease'
  const visibleYaml = secretRedacted ? redactSecretYaml(yamlText) : draftYaml

  async function applyYaml() {
    if (!yamlText) return
    if (secretRedacted) {
      setActionError('Reveal encoded Secret values before applying YAML.')

      return
    }
    setSaving(true)
    setActionError(null)
    const applyTargetKey = detailTargetKey(target)
    const isCurrentTarget = () => detailTargetKey(targetRef.current) === applyTargetKey

    try {
      const expectedIdentity = getYamlIdentity(yamlText, target.namespace)

      await api.applyResourceYaml(context, draftYaml, expectedIdentity)
      if (!isCurrentTarget()) return
      const next = await api.getResourceYaml(
        context,
        target.kind,
        target.namespace,
        target.name,
        target.apiVersion,
        target.plural,
      )

      if (!isCurrentTarget()) return
      setYamlText(next)
      setDraftYaml(next)
    } catch (e) {
      if (!isCurrentTarget()) return
      setActionError(String(e instanceof Error ? e.message : e))
    } finally {
      if (isCurrentTarget()) setSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col bg-zGray-950">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-zGray-800 bg-zGray-900 px-6 py-2.5">
        <div className="min-w-0 text-[12.5px] text-tertiary">
          {helmReleaseReadOnly
            ? 'Helm release storage is read-only to avoid corrupting the encoded release payload.'
            : target.kind === 'Secret'
              ? 'Secret data and stringData values are redacted by default.'
              : 'Edit the manifest and apply it to this object.'}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => editorRef.current?.openSearchPanel()}
            title="Find (Cmd+F / Ctrl+F)"
            className="inline-flex h-7 flex-shrink-0 items-center gap-1.5 rounded bg-zGray-800 px-2.5 text-[12px] text-main hover:bg-zGray-750"
          >
            <Search className="h-3.5 w-3.5" strokeWidth={2} />
            Find
          </button>
          {target.kind === 'Secret' && (
            <button
              type="button"
              onClick={() => setShowSecretValues((value) => !value)}
              className="inline-flex h-7 flex-shrink-0 items-center gap-1.5 rounded bg-zGray-800 px-2.5 text-[12px] text-main hover:bg-zGray-750"
            >
              <Eye className="h-3.5 w-3.5" strokeWidth={2} />
              {showSecretValues ? 'Hide values' : 'Reveal encoded values'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void applyYaml()}
            disabled={saving || secretRedacted || helmReleaseReadOnly || draftYaml === yamlText}
            className="inline-flex h-7 flex-shrink-0 items-center rounded bg-zViolet-500 px-3 text-[12px] font-medium text-white hover:bg-zViolet-400 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-zViolet-500"
          >
            {saving ? 'Applying...' : 'Apply'}
          </button>
        </div>
      </div>
      {actionError && (
        <div className="border-b border-error/20 bg-error/10 px-6 py-2 text-[12.5px] text-error">
          {actionError}
        </div>
      )}
      {secretRedacted && (
        <div className="flex items-start gap-2 border-b border-warning/20 bg-warning/10 px-6 py-2 text-[12.5px] text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" strokeWidth={2} />
          <span>Reveal encoded values to edit and apply this Secret.</span>
        </div>
      )}
      <YamlEditor
        ref={editorRef}
        value={visibleYaml}
        onChange={setDraftYaml}
        readOnly={secretRedacted || helmReleaseReadOnly}
        className="flex-1 min-h-0"
      />
    </div>
  )
}

function redactSecretYaml(text: string): string {
  try {
    const loaded = yaml.load(text)

    if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) {
      throw new Error('Unexpected YAML shape')
    }
    const doc = loaded as K8sYamlObject
    const redacted: K8sYamlObject = { ...doc }

    if (doc.data && typeof doc.data === 'object') {
      redacted.data = redactRecord(doc.data)
    }
    if (doc.stringData && typeof doc.stringData === 'object') {
      redacted.stringData = redactRecord(doc.stringData)
    }

    return yaml.dump(redacted, { skipInvalid: true })
  } catch {
    return [
      'kind: Secret',
      'data: <redacted>',
      '',
      '# Unable to safely render redacted YAML for this object.',
      '# Use "Reveal encoded values" to inspect the original YAML.',
    ].join('\n')
  }
}

function redactRecord(record: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.keys(record).map((key) => [key, '<redacted>']))
}

function getYamlIdentity(yamlText: string, fallbackNamespace: string | null): ResourceYamlIdentity {
  const doc = yaml.load(yamlText) as {
    apiVersion?: unknown
    kind?: unknown
    metadata?: { name?: unknown; namespace?: unknown }
  } | null

  if (
    !doc ||
    typeof doc !== 'object' ||
    Array.isArray(doc) ||
    typeof doc.apiVersion !== 'string' ||
    typeof doc.kind !== 'string' ||
    !doc.metadata ||
    typeof doc.metadata.name !== 'string'
  ) {
    throw new Error('Original YAML identity could not be determined.')
  }

  return {
    apiVersion: doc.apiVersion,
    kind: doc.kind,
    name: doc.metadata.name,
    namespace:
      typeof doc.metadata.namespace === 'string' ? doc.metadata.namespace : fallbackNamespace,
  }
}
