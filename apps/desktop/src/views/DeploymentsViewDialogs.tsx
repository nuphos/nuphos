import { useState } from 'react'

import { api } from '../api'
import { Modal } from '../components/Modal'

import type { DeploymentItem } from '../types'
import type { FormEvent } from 'react'

export function ScaleDeploymentDialog({
  target,
  onClose,
}: {
  target: { deployment: DeploymentItem; context: string }
  onClose: () => void
}) {
  const currentReplicas = desiredReplicasFromReady(target.deployment.ready)
  const [replicas, setReplicas] = useState(String(currentReplicas))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = replicas.trim()
    const nextReplicas = Number(trimmed)

    if (trimmed === '' || !Number.isInteger(nextReplicas) || nextReplicas < 0) {
      setError('Replicas must be a non-negative integer.')

      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.scaleDeployment(
        target.context,
        target.deployment.namespace,
        target.deployment.name,
        nextReplicas,
      )
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to scale deployment.')
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title="Scale deployment"
      description={`${target.deployment.namespace}/${target.deployment.name}`}
      onClose={onClose}
      width={360}
    >
      <form onSubmit={(event) => void submit(event)} className="p-4 space-y-4">
        <label className="block">
          <span className="block text-[12px] text-tertiary mb-1.5">Replicas</span>
          <input
            autoFocus
            type="number"
            min={0}
            step={1}
            value={replicas}
            onChange={(event) => setReplicas(event.target.value)}
            className="h-9 w-full rounded-md border border-zGray-700 bg-field px-2.5 text-[13px] text-main outline-none focus:border-zViolet-500"
          />
        </label>
        {error && <div className="text-[12.5px] text-error">{error}</div>}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-3 rounded-md text-[12.5px] text-secondary hover:bg-zGray-800 hover:text-main"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="h-8 px-3 rounded-md bg-zViolet-600 text-[12.5px] font-medium text-white hover:bg-zViolet-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Scaling...' : 'Scale'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function BulkScaleDialog({
  count,
  onClose,
  onApply,
}: {
  count: number
  onClose: () => void
  onApply: (replicas: number) => Promise<void> | void
}) {
  const [replicas, setReplicas] = useState('1')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = replicas.trim()
    const next = Number(trimmed)

    if (trimmed === '' || !Number.isInteger(next) || next < 0) {
      setError('Replicas must be a non-negative integer.')

      return
    }
    setSaving(true)
    setError(null)
    await onApply(next)
  }

  return (
    <Modal
      open
      title="Scale deployments"
      description={`Set replicas for ${String(count)} selected deployment${count === 1 ? '' : 's'}`}
      onClose={onClose}
      width={360}
    >
      <form onSubmit={(event) => void submit(event)} className="p-4 space-y-4">
        <label className="block">
          <span className="block text-[12px] text-tertiary mb-1.5">Replicas</span>
          <input
            autoFocus
            type="number"
            min={0}
            step={1}
            value={replicas}
            onChange={(event) => setReplicas(event.target.value)}
            className="h-9 w-full rounded-md border border-zGray-700 bg-field px-2.5 text-[13px] text-main outline-none focus:border-zViolet-500"
          />
        </label>
        {error && <div className="text-[12.5px] text-error">{error}</div>}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-3 rounded-md text-[12.5px] text-secondary hover:bg-zGray-800 hover:text-main"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="h-8 px-3 rounded-md bg-zViolet-600 text-[12.5px] font-medium text-white hover:bg-zViolet-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Scaling...' : 'Scale'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function desiredReplicasFromReady(ready: string): number {
  const desired = Number(ready.split('/')[1])

  return Number.isFinite(desired) && desired >= 0 ? desired : 0
}
