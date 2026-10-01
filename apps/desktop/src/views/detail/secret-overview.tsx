import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { Age } from '../../components/Age'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useRequiredKubeContext } from '../../hooks/useKubeContext'

import {
  byteLength,
  copyText,
  decodedSecretByteLength,
  decodeSecretText,
  formatBytes,
  parseK8sYamlObject,
  stringRecord,
} from './config-secret-model'
import { ActionError, KeyEditorDialog } from './key-editor-dialog'
import { KeyTable, MetadataPills } from './key-table'
import { Field, Section } from './shared'

import type { KeyDraft, KeyEntry } from './config-secret-model'
import type { DetailTarget } from './target'

export function SecretOverview({
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
  const stringData = stringRecord(doc.stringData)
  const [draft, setDraft] = useState<KeyDraft | null>(null)
  const [removeTarget, setRemoveTarget] = useState<KeyEntry | null>(null)
  const [revealedIds, setRevealedIds] = useState<Set<string>>(() => new Set())
  const [actionError, setActionError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const keys: KeyEntry[] = [
    ...Object.entries(data).map(([key, value]) => {
      const decoded = decodeSecretText(value)
      const binary = decoded === null

      return {
        id: `data:${key}`,
        key,
        source: 'data' as const,
        size: formatBytes(decodedSecretByteLength(value)),
        preview: binary ? 'Binary value · copy returns base64' : decoded,
        copyValue: binary ? value : decoded,
        editValue: decoded ?? undefined,
        editable: !binary && doc.immutable !== true,
        removable: doc.immutable !== true,
      }
    }),
    ...Object.entries(stringData).map(([key, value]) => ({
      id: `stringData:${key}`,
      key,
      source: 'stringData' as const,
      size: formatBytes(byteLength(value)),
      preview: value,
      copyValue: value,
      editValue: value,
      editable: doc.immutable !== true,
      removable: doc.immutable !== true,
    })),
  ].sort((a, b) => a.key.localeCompare(b.key))

  function toggleReveal(entry: KeyEntry) {
    setRevealedIds((current) => {
      const next = new Set(current)

      if (next.has(entry.id)) next.delete(entry.id)
      else next.add(entry.id)

      return next
    })
  }

  async function copyEntry(entry: KeyEntry) {
    await copyText(entry.copyValue ?? '')
    setCopiedId(entry.id)
    window.setTimeout(() => setCopiedId(null), 1200)
  }

  async function submitDraft(key: string, value: string) {
    if (!target.namespace || !draft) return
    setActionError(null)
    if (draft.original && draft.original.key !== key) {
      await api.upsertSecretKey(context, target.namespace, target.name, key, value)
      await api.removeSecretKey(context, target.namespace, target.name, draft.original.key)
    } else {
      await api.upsertSecretKey(context, target.namespace, target.name, key, value)
    }
    setDraft(null)
    await onReload()
  }

  async function removeKey(entry: KeyEntry) {
    if (!target.namespace) return
    setActionError(null)
    await api.removeSecretKey(context, target.namespace, target.name, entry.key)
    setRemoveTarget(null)
    await onReload()
  }

  return (
    <div className="p-6 space-y-4">
      {actionError && <ActionError message={actionError} />}
      <div className="flex items-start gap-3 border border-warning/20 bg-warning/10 px-4 py-3 text-[12.5px] text-warning">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" strokeWidth={2} />
        <div>
          Secret values are hidden by default. Text values can be decoded and edited; binary values
          stay base64 encoded so opening this view cannot corrupt their bytes.
        </div>
      </div>
      <Section>
        <Field label="Namespace" value={doc.metadata?.namespace ?? '-'} />
        <Field
          label="Secret type"
          value={<span className="font-mono text-[12px]">{doc.type ?? 'Opaque'}</span>}
        />
        <Field label="Keys" value={String(keys.length)} />
        <Field label="API Version" value={doc.apiVersion ?? '-'} />
        <Field
          label="Created"
          value={
            doc.metadata?.creationTimestamp ? <Age value={doc.metadata.creationTimestamp} /> : '-'
          }
        />
        <Field label="Kind" value={doc.kind ?? 'Secret'} />
        <Field
          label="Mutability"
          value={doc.immutable ? <span className="text-warning">Immutable</span> : 'Mutable'}
        />
      </Section>
      <MetadataPills
        labels={stringRecord(doc.metadata?.labels)}
        annotations={stringRecord(doc.metadata?.annotations)}
      />
      <KeyTable
        title="Secret keys"
        keys={keys}
        empty="This Secret has no data keys."
        redacted
        revealedIds={revealedIds}
        copiedId={copiedId}
        addDisabled={doc.immutable === true}
        onAdd={() =>
          setDraft({
            title: 'Add Secret key',
            key: '',
            value: '',
            submitLabel: 'Add key',
          })
        }
        onCopy={(entry) => void copyEntry(entry).catch((e: unknown) => setActionError(String(e)))}
        onEdit={(entry) =>
          setDraft({
            title: 'Edit Secret key',
            key: entry.key,
            value: entry.editValue ?? '',
            submitLabel: 'Save key',
            original: entry,
          })
        }
        onRemove={setRemoveTarget}
        onToggleReveal={toggleReveal}
      />
      <KeyEditorDialog
        draft={draft}
        valueLabel="Decoded value"
        onClose={() => setDraft(null)}
        onSubmit={submitDraft}
        onError={(message) => setActionError(message)}
      />
      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Remove key"
        description={removeTarget ? `Remove "${removeTarget.key}" from this Secret?` : ''}
        confirmLabel="Remove"
        destructive
        onConfirm={() => (removeTarget ? removeKey(removeTarget) : undefined)}
        onClose={() => setRemoveTarget(null)}
      />
    </div>
  )
}
