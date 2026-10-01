import { useState } from 'react'

import { api } from '../../api'
import { Age } from '../../components/Age'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useRequiredKubeContext } from '../../hooks/useKubeContext'

import {
  byteLength,
  copyText,
  formatBytes,
  parseK8sYamlObject,
  previewValue,
  stringRecord,
} from './config-secret-model'
import { ActionError, KeyEditorDialog } from './key-editor-dialog'
import { KeyTable, MetadataPills } from './key-table'
import { Field, Section } from './shared'

import type { KeyDraft, KeyEntry } from './config-secret-model'
import type { DetailTarget } from './target'

export function ConfigMapOverview({
  target,
  yamlText,
  onReload,
}: {
  target: DetailTarget
  yamlText: string
  onReload: () => Promise<void>
}) {
  const context = useRequiredKubeContext()
  const doc = parseK8sYamlObject(yamlText)
  const data = stringRecord(doc.data)
  const binaryData = stringRecord(doc.binaryData)
  const [draft, setDraft] = useState<KeyDraft | null>(null)
  const [removeTarget, setRemoveTarget] = useState<KeyEntry | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const keys: KeyEntry[] = [
    ...Object.entries(data).map(([key, value]) => ({
      id: `data:${key}`,
      key,
      source: 'data' as const,
      size: formatBytes(byteLength(value)),
      preview: previewValue(value),
      copyValue: value,
      editValue: value,
      editable: doc.immutable !== true,
      removable: doc.immutable !== true,
    })),
    ...Object.entries(binaryData).map(([key, value]) => ({
      id: `binaryData:${key}`,
      key,
      source: 'binaryData' as const,
      size: formatBytes(value.length),
      preview: 'Binary value',
      copyValue: value,
      editable: false,
      removable: doc.immutable !== true,
    })),
  ].sort((a, b) => a.key.localeCompare(b.key))

  async function copyEntry(entry: KeyEntry) {
    await copyText(entry.copyValue ?? '')
    setCopiedId(entry.id)
    window.setTimeout(() => setCopiedId(null), 1200)
  }

  async function submitDraft(key: string, value: string) {
    if (!target.namespace || !draft) return
    setActionError(null)
    const source = draft.original?.source === 'binaryData' ? 'binaryData' : 'data'

    if (draft.original && draft.original.key !== key) {
      await api.upsertConfigMapKey(context, target.namespace, target.name, key, value, source)
      await api.removeConfigMapKey(
        context,
        target.namespace,
        target.name,
        draft.original.key,
        draft.original.source === 'binaryData' ? 'binaryData' : 'data',
      )
    } else {
      await api.upsertConfigMapKey(context, target.namespace, target.name, key, value, source)
    }
    setDraft(null)
    await onReload()
  }

  async function removeKey(entry: KeyEntry) {
    if (!target.namespace) return
    setActionError(null)
    await api.removeConfigMapKey(
      context,
      target.namespace,
      target.name,
      entry.key,
      entry.source === 'binaryData' ? 'binaryData' : 'data',
    )
    setRemoveTarget(null)
    await onReload()
  }

  return (
    <div className="p-6 space-y-4">
      {actionError && <ActionError message={actionError} />}
      <Section>
        <Field label="Namespace" value={doc.metadata?.namespace ?? '-'} />
        <Field label="Data keys" value={String(keys.length)} />
        <Field label="API Version" value={doc.apiVersion ?? '-'} />
        <Field
          label="Mode"
          value={doc.immutable ? <span className="text-amber-300">Immutable</span> : 'Mutable'}
        />
        <Field
          label="Created"
          value={
            doc.metadata?.creationTimestamp ? <Age value={doc.metadata.creationTimestamp} /> : '-'
          }
        />
        <Field label="Kind" value={doc.kind ?? 'ConfigMap'} />
      </Section>
      <MetadataPills
        labels={stringRecord(doc.metadata?.labels)}
        annotations={stringRecord(doc.metadata?.annotations)}
      />
      <KeyTable
        title="Keys"
        keys={keys}
        empty="This ConfigMap has no data keys."
        copiedId={copiedId}
        addDisabled={doc.immutable === true}
        onAdd={() =>
          setDraft({
            title: 'Add ConfigMap key',
            key: '',
            value: '',
            submitLabel: 'Add key',
          })
        }
        onCopy={(entry) => void copyEntry(entry).catch((e: unknown) => setActionError(String(e)))}
        onEdit={(entry) =>
          setDraft({
            title: 'Edit ConfigMap key',
            key: entry.key,
            value: entry.editValue ?? '',
            submitLabel: 'Save key',
            original: entry,
          })
        }
        onRemove={setRemoveTarget}
      />
      <KeyEditorDialog
        draft={draft}
        valueLabel="Value"
        onClose={() => setDraft(null)}
        onSubmit={submitDraft}
        onError={(message) => setActionError(message)}
      />
      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Remove key"
        description={removeTarget ? `Remove "${removeTarget.key}" from this ConfigMap?` : ''}
        confirmLabel="Remove"
        destructive
        onConfirm={() => (removeTarget ? removeKey(removeTarget) : undefined)}
        onClose={() => setRemoveTarget(null)}
      />
    </div>
  )
}
