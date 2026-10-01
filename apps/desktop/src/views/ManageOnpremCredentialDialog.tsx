import { useState } from 'react'

import { api } from '../api'
import { Modal } from '../components/Modal'
import { toast } from '../components/ui/toast'

import { AccessStep } from './bind-onprem/steps'

import type { OnpremCluster, OnpremClusterAccess } from '../types'

export function ManageOnpremCredentialDialog({
  teamId,
  cluster,
  onClose,
  onSaved,
}: {
  teamId: string
  cluster: OnpremCluster
  onClose: () => void
  onSaved: () => void
}) {
  const [kubeconfig, setKubeconfig] = useState('')
  const [access, setAccess] = useState<OnpremClusterAccess | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    const next = kubeconfig.trim()

    if (!next) return toast.error('Paste the kubeconfig printed by the command above.')
    setBusy(true)
    try {
      await api.atlasSetOnpremClusterKubeconfig(teamId, cluster.id, next)
      setAccess(await api.atlasOnpremClusterAccess(teamId, cluster.id))
      onSaved()
    } catch (cause) {
      toast.apiError('Could not update the cluster credential', cause, {
        fallback: 'Check that the kubeconfig has a server address, CA and ServiceAccount token.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Manage ${cluster.label} access`} width={640}>
      <div className="px-5 py-4 text-[13px]">
        <AccessStep
          kubeconfig={kubeconfig}
          onChange={setKubeconfig}
          access={access}
          namespace={cluster.label}
        />
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-zGray-850 px-5 py-3">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="px-3 py-1.5 rounded-md text-secondary hover:text-main text-[12.5px] disabled:opacity-50"
        >
          {access?.reachable ? 'Done' : 'Close'}
        </button>
        {!access?.reachable && (
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="px-3 py-1.5 rounded-md bg-zViolet-500 hover:bg-zViolet-400 text-white text-[12.5px] disabled:opacity-50"
          >
            {busy ? 'Checking…' : 'Save and check access'}
          </button>
        )}
      </div>
    </Modal>
  )
}
