import { useCallback, useState } from 'react'

import { api } from '../api'
import { WizardStepBar } from '../components/ConnectorWizard'
import { Modal } from '../components/Modal'
import { toast } from '../components/ui/toast'

import { AccessStep, InstallStep, NameStep } from './bind-onprem/steps'

import type { OnpremCluster, OnpremClusterAccess, OnpremClusterInstall } from '../types'

// Enrolling a Kubernetes cluster we cannot dial: the customer runs one
// outbound-only pod and we watch it arrive.
//
// The order is the point. Naming and installing come first, the credential
// last — so the tunnel is proven with nothing at stake, and by the time a
// credential changes hands we can show what it actually grants, asked of their
// own API server rather than claimed by us.
const STEPS = ['Name it', 'Install the agent', 'Grant access']

type Props = {
  teamId: string
  onClose: () => void
  onBound: () => void
}

export function BindOnpremClusterDialog({ teamId, onClose, onBound }: Props) {
  const [step, setStep] = useState(0)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [cluster, setCluster] = useState<OnpremCluster | null>(null)
  const [install, setInstall] = useState<OnpremClusterInstall | null>(null)
  const [connected, setConnected] = useState(false)
  const [agentVersion, setAgentVersion] = useState<string | null>(null)
  const [kubeconfig, setKubeconfig] = useState('')
  const [access, setAccess] = useState<OnpremClusterAccess | null>(null)

  // Closing after the cluster exists still counts as progress — the operator can
  // come back to a half-finished enrolment rather than starting over.
  const close = useCallback(() => {
    if (busy) return
    if (cluster) onBound()
    onClose()
  }, [busy, cluster, onBound, onClose])

  async function createCluster() {
    const next = label.trim()

    if (!/^[a-z0-9][a-z0-9-]*$/.test(next)) {
      return toast.error(
        'Use lowercase letters, digits and dashes — the name becomes a kubectl context.',
      )
    }
    setBusy(true)
    try {
      const result = await api.atlasEnrolOnpremCluster(teamId, next)

      setCluster(result.cluster)
      setInstall(result.install)
      setStep(1)
    } catch (cause) {
      toast.apiError('Could not create the cluster', cause, {
        fallback: 'Check your connection and try again.',
      })
    } finally {
      setBusy(false)
    }
  }

  async function saveKubeconfig() {
    if (!cluster) return
    const next = kubeconfig.trim()

    if (!next) return toast.error('Paste the kubeconfig for the ServiceAccount you created.')
    setBusy(true)
    try {
      await api.atlasSetOnpremClusterKubeconfig(teamId, cluster.id, next)
      // Ask the cluster what the credential can do rather than telling them.
      setAccess(await api.atlasOnpremClusterAccess(teamId, cluster.id))
    } catch (cause) {
      toast.apiError('Could not use that kubeconfig', cause, {
        fallback: 'Check that it has a server address, a CA and a token.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={close} title="Connect a Kubernetes cluster" width={640}>
      <div className="px-5 py-4 text-[13px]">
        <WizardStepBar steps={STEPS} current={step} />

        {step === 0 && (
          <NameStep label={label} onChange={setLabel} onSubmit={() => void createCluster()} />
        )}

        {step === 1 && install && cluster && (
          <InstallStep
            teamId={teamId}
            clusterId={cluster.id}
            install={install}
            connected={connected}
            agentVersion={agentVersion}
            onConnected={(version) => {
              setConnected(true)
              setAgentVersion(version)
            }}
          />
        )}

        {step === 2 && cluster && (
          <AccessStep
            kubeconfig={kubeconfig}
            onChange={setKubeconfig}
            access={access}
            namespace={cluster.label}
          />
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-zGray-850 px-5 py-3">
        <button
          type="button"
          onClick={close}
          disabled={busy}
          className="px-3 py-1.5 rounded-md text-secondary hover:text-main text-[12.5px] disabled:opacity-50"
        >
          {access?.reachable ? 'Done' : 'Close'}
        </button>
        {step === 0 && (
          <PrimaryButton busy={busy} onClick={() => void createCluster()}>
            {busy ? 'Creating…' : 'Continue'}
          </PrimaryButton>
        )}
        {step === 1 && (
          <PrimaryButton busy={busy} disabled={!connected} onClick={() => setStep(2)}>
            {connected ? 'Continue' : 'Waiting for the agent…'}
          </PrimaryButton>
        )}
        {step === 2 && !access?.reachable && (
          <PrimaryButton busy={busy} onClick={() => void saveKubeconfig()}>
            {busy ? 'Checking…' : 'Save and check access'}
          </PrimaryButton>
        )}
      </div>
    </Modal>
  )
}

function PrimaryButton({
  busy,
  disabled,
  onClick,
  children,
}: {
  busy?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className="px-3 py-1.5 rounded-md bg-zViolet-500 hover:bg-zViolet-400 text-white text-[12.5px] disabled:opacity-50"
    >
      {children}
    </button>
  )
}
