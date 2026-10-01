import { faPlus, faXmark } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Modal } from '../../components/Modal'
import { toast } from '../../components/ui/toast'

export function PagesDomainsSection({
  teamId,
  accountId,
  projectName,
}: {
  teamId: string
  accountId: string
  projectName: string
}) {
  const [domains, setDomains] = useState<
    { id: string | null; name: string; status: string | null }[]
  >([])
  const [adding, setAdding] = useState(false)
  const [newDomain, setNewDomain] = useState('')
  const [pendingRemove, setPendingRemove] = useState<string | null>(null)

  const reload = useCallback(() => {
    api
      .atlasListCloudflarePagesDomains(teamId, accountId, projectName)
      .then(setDomains)
      .catch((err: unknown) => toast.apiError('Failed to load custom domains', err))
  }, [teamId, accountId, projectName])

  useEffect(() => reload(), [reload])

  async function addDomain() {
    if (!newDomain.trim()) return
    try {
      await api.atlasAddCloudflarePagesDomain(teamId, accountId, projectName, newDomain.trim())
      setNewDomain('')
      setAdding(false)
      toast.success('Domain added')
      reload()
    } catch (e) {
      toast.apiError('Failed to add domain', e, {
        fallback: 'Check your connection and try again.',
      })
    }
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[12px] font-medium text-main">Custom domains</span>
        <button
          onClick={() => setAdding((v) => !v)}
          className="text-[12px] text-zViolet-accent hover:underline flex items-center gap-1"
        >
          <FontAwesomeIcon icon={faPlus} className="w-3 h-3" /> Add
        </button>
      </div>
      {adding && (
        <div className="flex items-center gap-2 mb-2">
          <input
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            placeholder="www.example.com"
            className="px-2.5 py-1.5 rounded-md bg-field border border-zGray-800 text-main outline-none focus:border-zViolet-accent font-mono text-[12px] w-64"
          />
          <button
            onClick={() => void addDomain()}
            className="px-2.5 py-1.5 rounded-md bg-zViolet-500 hover:bg-zViolet-400 text-white text-[12px]"
          >
            Add
          </button>
        </div>
      )}
      {domains.length === 0 ? (
        <div className="text-tertiary">No custom domains</div>
      ) : (
        <div className="space-y-1">
          {domains.map((d) => (
            <div key={d.name} className="flex items-center gap-2">
              <span className="font-mono text-[12px] text-secondary">{d.name}</span>
              {d.status && <span className="text-[11px] text-tertiary">({d.status})</span>}
              <button
                onClick={() => setPendingRemove(d.name)}
                className="w-5 h-5 rounded text-tertiary hover:bg-error/15 hover:text-error flex items-center justify-center"
                title="Remove domain"
              >
                <FontAwesomeIcon icon={faXmark} className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingRemove}
        title="Remove custom domain?"
        description={
          pendingRemove ? `"${pendingRemove}" will stop serving this Pages project.` : ''
        }
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (!pendingRemove) return
          try {
            await api.atlasDeleteCloudflarePagesDomain(
              teamId,
              accountId,
              projectName,
              pendingRemove,
            )
            toast.success('Domain removed')
            reload()
          } catch (e) {
            toast.apiError('Failed to remove domain', e, {
              fallback: 'Check your connection and try again.',
            })
          }
        }}
        onClose={() => setPendingRemove(null)}
      />
    </section>
  )
}

export function PagesDeploymentLogsModal({
  teamId,
  accountId,
  projectName,
  deploymentId,
  onClose,
}: {
  teamId: string
  accountId: string
  projectName: string
  deploymentId: string
  onClose: () => void
}) {
  const [logs, setLogs] = useState<{ ts: string | null; line: string }[] | null>(null)

  useEffect(() => {
    api
      .atlasGetCloudflarePagesDeploymentLogs(teamId, accountId, projectName, deploymentId)
      .then(setLogs)
      .catch((e: unknown) => {
        toast.apiError('Failed to load logs', e)
        onClose()
      })
  }, [teamId, accountId, projectName, deploymentId, onClose])

  return (
    <Modal
      open
      onClose={onClose}
      title="Deployment logs"
      description={deploymentId.slice(0, 12)}
      width={720}
    >
      <div className="px-5 py-4 max-h-[60vh] overflow-auto">
        {!logs ? (
          <div className="text-tertiary text-[12px]">Loading…</div>
        ) : logs.length === 0 ? (
          <div className="text-tertiary text-[12px]">No log lines</div>
        ) : (
          <pre className="text-[11.5px] font-mono text-secondary whitespace-pre-wrap break-all">
            {logs.map((l) => l.line).join('\n')}
          </pre>
        )}
      </div>
    </Modal>
  )
}
