import { useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { WizardCopyableBlock, WizardStepList } from '../../components/ConnectorWizard'

import { persistentCredentialCommand } from './persistentCredential'

import type { OnpremClusterAccess, OnpremClusterInstall } from '../../types'

const POLL_INTERVAL_MS = 2000

export function NameStep({
  label,
  onChange,
  onSubmit,
}: {
  label: string
  onChange: (value: string) => void
  onSubmit: () => void
}) {
  return (
    <div className="space-y-3">
      <p className="text-secondary text-[12.5px] leading-relaxed">
        For a cluster with no reachable API server. You run one small pod in it; the pod dials out
        to Nuphos and nothing dials in. It needs no inbound port, no Service and no privileges.
      </p>
      <label className="block">
        <div className="text-[12px] text-secondary mb-1">Name</div>
        <input
          value={label}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSubmit()
          }}
          placeholder="acme-dc1"
          autoFocus
          className="w-full px-2.5 py-1.5 rounded-md bg-field border border-zGray-800 text-main outline-none focus:border-zViolet-accent font-mono text-[12.5px]"
        />
        <div className="text-[11px] text-tertiary mt-1">
          Becomes the kubectl context the agent uses —{' '}
          <code>onprem/{label || 'acme-dc1'}/cluster</code>.
        </div>
      </label>
    </div>
  )
}

export function InstallStep({
  teamId,
  clusterId,
  install,
  connected,
  agentVersion,
  onConnected,
}: {
  teamId: string
  clusterId: string
  install: OnpremClusterInstall
  connected: boolean
  agentVersion: string | null
  onConnected: (agentVersion: string | null) => void
}) {
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null)
  const [relayDown, setRelayDown] = useState(false)
  const stop = useRef(false)

  useEffect(() => {
    stop.current = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function poll() {
      try {
        const status = await api.atlasOnpremClusterConnection(teamId, clusterId)

        if (stop.current) return
        setRelayDown(status.connected === null)
        setLastSeenAt(status.lastSeenAt ?? null)
        if (status.connected) {
          onConnected(status.agentVersion ?? null)

          return // Connected is terminal: stop polling.
        }
      } catch {
        // A failed poll is not news — the pod is probably still starting.
      }
      if (!stop.current) timer = setTimeout(() => void poll(), POLL_INTERVAL_MS)
    }

    void poll()

    return () => {
      stop.current = true
      if (timer) clearTimeout(timer)
    }
  }, [teamId, clusterId, onConnected])

  return (
    <div className="space-y-3">
      <WizardStepList>
        <li>Run this against the cluster, as someone who can create a namespace.</li>
      </WizardStepList>
      <WizardCopyableBlock value={`kubectl apply -f - <<'EOF'\n${install.manifest}EOF`} />
      <p className="text-[11px] text-tertiary leading-relaxed">
        The token in it is shown once and we keep no copy. To cut access off later, scale the
        deployment to zero — that is instant and does not need us.
      </p>

      <div
        className={`flex items-center gap-2 rounded-md border px-3 py-2 text-[12.5px] ${
          connected
            ? 'border-emerald-900/60 bg-emerald-950/30 text-emerald-300'
            : 'border-zGray-800 bg-zGray-900 text-secondary'
        }`}
      >
        <span
          className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-400' : 'animate-pulse bg-zGray-600'}`}
        />
        {connected ? (
          <span>Agent connected{agentVersion ? ` · build ${agentVersion}` : ''}.</span>
        ) : relayDown ? (
          <span>Nuphos cannot reach its own relay right now — this one is on us.</span>
        ) : (
          <span>
            Waiting for the agent to connect
            {lastSeenAt ? ` · last seen ${new Date(lastSeenAt).toLocaleTimeString()}` : ''}…
          </span>
        )}
      </div>
    </div>
  )
}

export function AccessStep({
  kubeconfig,
  onChange,
  access,
  namespace,
}: {
  kubeconfig: string
  onChange: (value: string) => void
  access: OnpremClusterAccess | null
  namespace: string
}) {
  if (access) return <AccessReadout access={access} />

  return (
    <div className="space-y-3">
      <p className="text-secondary text-[12.5px] leading-relaxed">
        The tunnel carries bytes; it does not authenticate to Kubernetes. Run this to create a
        persistent ServiceAccount credential with cluster-admin access, then paste the kubeconfig it
        prints. Full access is required for resource management, terminals, port forwarding, and
        Agent operations. Nuphos still applies your permission and confirmation settings before
        privileged actions. Delete the ServiceAccount Secret to revoke access.
      </p>
      <WizardCopyableBlock value={persistentCredentialCommand(namespace)} />
      <p className="text-[11px] text-tertiary leading-relaxed">
        Do not use <code>kubectl create token</code> here: many clusters shorten its requested
        lifetime to one hour, which later causes HTTP 401 errors.
      </p>
      <label className="block">
        <div className="text-[12px] text-secondary mb-1">kubeconfig</div>
        <textarea
          value={kubeconfig}
          onChange={(event) => onChange(event.target.value)}
          rows={8}
          placeholder={`apiVersion: v1\nkind: Config\nclusters:\n  - name: ${namespace}\n    cluster:\n      server: https://10.0.0.1:6443\n      certificate-authority-data: …`}
          className="w-full px-2.5 py-1.5 rounded-md bg-field border border-zGray-800 text-main outline-none focus:border-zViolet-accent font-mono text-[11.5px]"
        />
        <div className="text-[11px] text-tertiary mt-1">
          The server address is the one that works <em>inside</em> the cluster. It never has to be
          publicly resolvable.
        </div>
      </label>
    </div>
  )
}

function AccessReadout({ access }: { access: OnpremClusterAccess }) {
  if (!access.reachable) {
    return (
      <div className="space-y-2">
        <div className="rounded-md border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-[12.5px] text-amber-200">
          {access.unreachableReason ?? 'Could not reach the API server through the relay.'}
        </div>
        <p className="text-[11px] text-tertiary">
          The cluster is saved. Fix the cause and re-check from its page.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-emerald-900/60 bg-emerald-950/30 px-3 py-2 text-[12.5px] text-emerald-300">
        Connected to the API server{access.serverVersion ? ` · ${access.serverVersion}` : ''}.
      </div>
      <dl className="space-y-2 text-[12.5px]">
        {access.identity && (
          <Row label="Identity">
            <span className="font-mono text-[11.5px] text-main">{access.identity.username}</span>
          </Row>
        )}
        {access.permissions && (
          <Row label={permissionsLabel(access.permissions.canWrite)}>
            <ul className="space-y-0.5 text-secondary">
              {access.permissions.summary.length ? (
                access.permissions.summary.map((line) => <li key={line}>{line}</li>)
              ) : (
                <li>No resource permissions in {access.permissions.namespace}.</li>
              )}
            </ul>
            {access.permissions.incompleteReason && (
              <p className="mt-1 text-[11px] text-amber-300/90">
                {access.permissions.incompleteReason} Rules missing from a partial answer could
                include write access, so this is not a read-only guarantee.
              </p>
            )}
          </Row>
        )}
        {access.namespaces && (
          <Row label="Namespaces">
            {access.namespaces.denied ? (
              <span className="text-secondary">Not allowed to list them.</span>
            ) : (
              <span className="text-secondary">
                {access.namespaces.count} visible
                {access.namespaces.sample.length ? ` · ${access.namespaces.sample.join(', ')}` : ''}
              </span>
            )}
          </Row>
        )}
      </dl>
      <p className="text-[11px] text-tertiary leading-relaxed">
        This is what Kubernetes says the credential can do, not what we claim. Widen or narrow it
        with RBAC in your cluster and re-check.
      </p>
    </div>
  )
}

/** Never call an indeterminate answer "Read-only" — see canWrite in the readout. */
function permissionsLabel(canWrite: boolean | null): string {
  if (canWrite === null) return 'Partly evaluated'

  return canWrite ? 'Can change things' : 'Read-only'
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[132px_minmax(0,1fr)] gap-3">
      <dt className="text-tertiary">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}
