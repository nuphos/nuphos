import clsx from 'clsx'

import { Age } from '../../components/Age'
import { parsePvSummary, parsePvcSummary, storagePhaseTone } from '../../lib/storageOverview'

import { Field, OverviewChipList, Section } from './shared'
import { useResourceDoc } from './use-resource-doc'

import type { DetailTarget } from './target'
import type { StorageChip, StoragePhaseTone } from '../../lib/storageOverview'

function storagePhaseClass(tone: StoragePhaseTone): string {
  return tone === 'good'
    ? 'text-success'
    : tone === 'warning'
      ? 'text-warning'
      : tone === 'error'
        ? 'text-error'
        : 'text-main'
}

function StoragePhaseValue({ phase }: { phase: string | null }) {
  if (!phase) return <span className="text-tertiary">-</span>

  return (
    <span className={clsx('font-medium', storagePhaseClass(storagePhaseTone(phase)))}>{phase}</span>
  )
}

// Clickable value for PV↔PVC cross-links (Volume / Claim). Falls back to a
// non-interactive accent label when navigation isn't wired up.
function StorageNavValue({ label, onClick }: { label: string; onClick?: () => void }) {
  if (!onClick) return <span className="text-zViolet-accent break-all">{label}</span>

  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left text-zViolet-accent hover:underline break-all"
    >
      {label}
    </button>
  )
}

function StorageTextValue({ value }: { value: string }) {
  if (!value || value === '-') return <span className="text-tertiary">-</span>

  return <span className="break-all">{value}</span>
}

function StorageChipCard({ label, chips }: { label: string; chips: StorageChip[] }) {
  return (
    <div className="bg-zGray-900 border border-zGray-800 rounded-md px-4 py-3">
      <div className="text-[11.5px] uppercase tracking-wider text-tertiary mb-1.5">{label}</div>
      <OverviewChipList chips={chips} />
    </div>
  )
}

export function PvcOverview({
  target,
  refreshKey,
  onNavigate,
}: {
  target: DetailTarget
  refreshKey: number
  onNavigate?: (target: DetailTarget) => void
}) {
  const { doc, loading, error } = useResourceDoc(target, refreshKey)

  if (error) return <div className="p-6 text-error text-[13px]">{error}</div>
  if (loading) return <div className="p-6 text-tertiary text-[13px]">Loading…</div>

  const summary = parsePvcSummary(doc)
  const volumeName = summary.volumeName
  const openVolume =
    volumeName && onNavigate
      ? () => onNavigate({ kind: 'PersistentVolume', namespace: null, name: volumeName })
      : undefined

  return (
    <div className="p-6 space-y-5">
      <Section>
        <Field label="Phase" value={<StoragePhaseValue phase={summary.phase} />} />
        <Field
          label="Age"
          value={
            summary.age ? <Age value={summary.age} /> : <span className="text-tertiary">-</span>
          }
        />
        <Field
          label="Namespace"
          value={<span className="text-zViolet-accent">{summary.namespace}</span>}
        />
        <Field label="Storage Class" value={<StorageTextValue value={summary.storageClass} />} />
        <Field label="Capacity" value={<StorageTextValue value={summary.capacity} />} />
        <Field label="Requested" value={<StorageTextValue value={summary.requested} />} />
        <Field label="Access Modes" value={<OverviewChipList chips={summary.accessModes} />} />
        <Field label="Volume Mode" value={<StorageTextValue value={summary.volumeMode} />} />
        <Field
          label="Volume"
          value={
            volumeName ? (
              <StorageNavValue label={volumeName} onClick={openVolume} />
            ) : (
              <span className="text-tertiary">-</span>
            )
          }
        />
      </Section>
      <StorageChipCard label="Labels" chips={summary.labels} />
      <StorageChipCard label="Annotations" chips={summary.annotations} />
      {summary.finalizers.length > 0 && (
        <StorageChipCard label="Finalizers" chips={summary.finalizers} />
      )}
    </div>
  )
}

export function PvOverview({
  target,
  refreshKey,
  onNavigate,
}: {
  target: DetailTarget
  refreshKey: number
  onNavigate?: (target: DetailTarget) => void
}) {
  const { doc, loading, error } = useResourceDoc(target, refreshKey)

  if (error) return <div className="p-6 text-error text-[13px]">{error}</div>
  if (loading) return <div className="p-6 text-tertiary text-[13px]">Loading…</div>

  const summary = parsePvSummary(doc)
  const claim = summary.claim
  // A PVC is namespaced, so only offer the cross-link when we have both parts —
  // navigating with a null namespace would query the wrong (or no) PVC.
  const openClaim =
    claim && claim.namespace && onNavigate
      ? () =>
          onNavigate({
            kind: 'PersistentVolumeClaim',
            namespace: claim.namespace,
            name: claim.name,
          })
      : undefined
  const claimLabel = claim
    ? claim.namespace
      ? `${claim.namespace}/${claim.name}`
      : claim.name
    : null

  return (
    <div className="p-6 space-y-5">
      <Section>
        <Field label="Phase" value={<StoragePhaseValue phase={summary.phase} />} />
        <Field
          label="Age"
          value={
            summary.age ? <Age value={summary.age} /> : <span className="text-tertiary">-</span>
          }
        />
        <Field label="Capacity" value={<StorageTextValue value={summary.capacity} />} />
        <Field label="Storage Class" value={<StorageTextValue value={summary.storageClass} />} />
        <Field label="Access Modes" value={<OverviewChipList chips={summary.accessModes} />} />
        <Field label="Reclaim Policy" value={<StorageTextValue value={summary.reclaimPolicy} />} />
        <Field label="Volume Mode" value={<StorageTextValue value={summary.volumeMode} />} />
        <Field
          label="Claim"
          value={
            claimLabel ? (
              <StorageNavValue label={claimLabel} onClick={openClaim} />
            ) : (
              <span className="text-tertiary">-</span>
            )
          }
        />
      </Section>
      {summary.csi && (
        <Section>
          <Field label="CSI Driver" value={<StorageTextValue value={summary.csi.driver} />} />
          <Field label="FS Type" value={<StorageTextValue value={summary.csi.fsType ?? '-'} />} />
          <Field
            label="Volume Handle"
            value={<StorageTextValue value={summary.csi.volumeHandle ?? '-'} />}
          />
        </Section>
      )}
      <StorageChipCard label="Labels" chips={summary.labels} />
      <StorageChipCard label="Annotations" chips={summary.annotations} />
      {summary.mountOptions.length > 0 && (
        <StorageChipCard label="Mount Options" chips={summary.mountOptions} />
      )}
      {summary.finalizers.length > 0 && (
        <StorageChipCard label="Finalizers" chips={summary.finalizers} />
      )}
    </div>
  )
}
