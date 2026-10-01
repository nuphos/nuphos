import { ExternalLink, GitBranch, GitPullRequest, Loader2, Search } from 'lucide-react'
import { useRef, useState } from 'react'

import { api } from '../api'
import { CloudLogo } from '../components/CloudLogo'
import { Modal } from '../components/Modal'
import { Checkbox } from '../components/ui/checkbox'
import { toast } from '../components/ui/toast'

import { useResetOnKey } from './useResetOnKey'

type Props = {
  open: boolean
  teamId: string
  onClose: () => void
  onBound: () => void
}

type Phase = { kind: 'idle' } | { kind: 'waiting' }

type GitlabScopeKey = 'repository' | 'mergeRequests'

const GITLAB_BASELINE_SCOPES = ['read_api', 'read_user', 'read_repository']

export function BindGitlabDialog({ open, teamId, onClose, onBound }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [hostUrl, setHostUrl] = useState('https://gitlab.com')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [scopeAccess, setScopeAccess] = useState<Record<GitlabScopeKey, boolean>>({
    repository: true,
    mergeRequests: true,
  })
  const attemptRef = useRef(0)

  // Keep the host/client values on close; users are likely to retry with the same.
  useResetOnKey(String(open), () => {
    if (!open) setPhase({ kind: 'idle' })
  })

  const normalizedHost = hostUrl.trim()
  const parsedHost = (() => {
    try {
      return new URL(normalizedHost)
    } catch {
      return null
    }
  })()
  const isValidHostUrl =
    parsedHost !== null && (parsedHost.protocol === 'http:' || parsedHost.protocol === 'https:')
  const selfHosted = isValidHostUrl && parsedHost.origin !== 'https://gitlab.com'

  // Self-hosted GitLab installs always need a per-binding OAuth app, since
  // the server-side defaults only target gitlab.com.
  useResetOnKey(String(selfHosted), () => {
    if (selfHosted) setShowAdvanced(true)
  })

  function close() {
    if (phase.kind === 'waiting') {
      attemptRef.current += 1
      // Tear down the pending OAuth server-side right away so the authorize
      // URL left open in the browser can't complete into a ghost binding.
      // This rejects the in-flight startGitlabOAuth promise, which the bumped
      // attemptRef above tells startInstall to ignore.
      void api.atlasCancelGitlabOAuth(teamId).catch(() => {})
    }
    onClose()
  }

  async function startInstall() {
    const attempt = ++attemptRef.current

    setPhase({ kind: 'waiting' })
    const scopes = [
      ...GITLAB_BASELINE_SCOPES,
      ...(scopeAccess.repository ? ['write_repository'] : []),
      ...(scopeAccess.mergeRequests ? ['api'] : []),
    ]

    try {
      await api.atlasStartGitlabOAuth(
        teamId,
        hostUrl.trim(),
        showAdvanced && clientId.trim() ? clientId.trim() : undefined,
        showAdvanced && clientSecret.trim() ? clientSecret.trim() : undefined,
        scopes,
      )
      if (attempt !== attemptRef.current) return
      onBound()
      onClose()
    } catch (e) {
      if (attempt !== attemptRef.current) return
      toast.apiError('Failed to connect GitLab', e)
      setPhase({ kind: 'idle' })
    }
  }

  const canStart =
    phase.kind !== 'waiting' &&
    isValidHostUrl &&
    (!selfHosted || (clientId.trim().length > 0 && clientSecret.trim().length > 0))

  return (
    <Modal
      open={open}
      onClose={close}
      title="Connect GitLab"
      description="Choose GitLab access for Zeabur Atlas, then authorize in your browser."
      width={500}
    >
      <div className="px-5 py-5 selectable">
        {phase.kind === 'idle' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-zGray-850 flex items-center justify-center">
                <CloudLogo provider="gitlab" size={26} />
              </div>
              <div className="text-[12.5px] text-secondary leading-relaxed text-center max-w-[400px]">
                Click below to open GitLab in your browser. Approve the OAuth request and you'll be
                redirected back automatically.
              </div>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-tertiary uppercase tracking-wide">GitLab host</span>
              <input
                type="url"
                value={hostUrl}
                onChange={(e) => setHostUrl(e.target.value)}
                placeholder="https://gitlab.com"
                className="h-8 px-2.5 rounded-md bg-field border border-zGray-700 text-[12.5px] text-main focus:outline-none focus:border-zViolet-500"
              />
            </label>

            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5 rounded-lg border border-zGray-800 bg-zGray-850/40 px-3 py-2">
                <Search className="h-3.5 w-3.5 text-[#fc6d26]" strokeWidth={1.8} />
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] leading-none text-main">Read projects</div>
                  <div className="mt-1 text-[10.5px] text-tertiary">
                    Projects, repositories, MRs, pipelines
                  </div>
                </div>
                <span className="rounded-md bg-zGray-800 px-2 py-1 text-[11px] font-medium text-secondary">
                  Always on
                </span>
              </div>

              <label className="flex items-center gap-2.5 rounded-lg border border-zGray-800 bg-zGray-850/40 px-3 py-2">
                <GitBranch className="h-3.5 w-3.5 text-[#fc6d26]" strokeWidth={1.8} />
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] leading-none text-main">Push branches</div>
                  <div className="mt-1 text-[10.5px] text-tertiary">
                    Clone, commit, and push repository branches
                  </div>
                </div>
                <Checkbox
                  checked={scopeAccess.repository}
                  onCheckedChange={(checked) =>
                    setScopeAccess((s) => ({ ...s, repository: checked }))
                  }
                  aria-label="Allow GitLab branch push access"
                />
              </label>

              <label className="flex items-center gap-2.5 rounded-lg border border-zGray-800 bg-zGray-850/40 px-3 py-2">
                <GitPullRequest className="h-3.5 w-3.5 text-[#fc6d26]" strokeWidth={1.8} />
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] leading-none text-main">Manage merge requests</div>
                  <div className="mt-1 text-[10.5px] text-tertiary">
                    Requests GitLab API access to open MRs, update metadata, and post comments
                  </div>
                </div>
                <Checkbox
                  checked={scopeAccess.mergeRequests}
                  onCheckedChange={(checked) =>
                    setScopeAccess((s) => ({ ...s, mergeRequests: checked }))
                  }
                  aria-label="Allow GitLab merge request access"
                />
              </label>
            </div>

            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="text-[11.5px] text-tertiary hover:text-secondary"
              >
                {showAdvanced ? 'Hide' : 'Show'} OAuth app settings
                {selfHosted && !showAdvanced && (
                  <span className="ml-1 text-error">(required for self-hosted)</span>
                )}
              </button>
            </div>

            {showAdvanced && (
              <div className="flex flex-col gap-3 border-t border-zGray-800 pt-3">
                <div className="text-[11.5px] text-tertiary">
                  {selfHosted
                    ? 'Self-hosted GitLab requires you to register an OAuth application on your instance and paste its credentials here.'
                    : 'Leave blank to use the server-default Zeabur OAuth app for gitlab.com.'}
                </div>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] text-tertiary uppercase tracking-wide">
                    OAuth application ID
                  </span>
                  <input
                    type="text"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="abc123…"
                    className="h-8 px-2.5 rounded-md bg-field border border-zGray-700 text-[12.5px] text-main font-mono focus:outline-none focus:border-zViolet-500"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] text-tertiary uppercase tracking-wide">
                    OAuth secret
                  </span>
                  <input
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder="gloas-…"
                    className="h-8 px-2.5 rounded-md bg-field border border-zGray-700 text-[12.5px] text-main font-mono focus:outline-none focus:border-zViolet-500"
                  />
                </label>
              </div>
            )}
          </div>
        )}

        {phase.kind === 'waiting' && (
          <div className="flex flex-col items-center gap-4 py-3">
            <Loader2 className="w-6 h-6 text-zViolet-accent animate-spin" strokeWidth={1.8} />
            <div className="text-[12.5px] text-secondary text-center">
              Waiting for GitLab… complete the authorization in your browser.
            </div>
            <div className="text-[11px] text-tertiary text-center max-w-[380px]">
              If nothing happens, make sure your browser allowed the popup and that your OS routes{' '}
              <span className="font-mono">nuphos://</span> URLs to this app.
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-zGray-800 bg-zGray-900/60">
        <button
          onClick={close}
          className="h-8 px-3 rounded-md text-[12.5px] text-secondary hover:text-main hover:bg-zGray-800"
        >
          {phase.kind === 'waiting' ? 'Cancel' : 'Close'}
        </button>
        {phase.kind !== 'waiting' && (
          <button
            onClick={() => void startInstall()}
            disabled={!canStart}
            className="h-8 px-3 rounded-md bg-zViolet-500 hover:bg-zViolet-400 disabled:bg-zGray-800 disabled:text-tertiary text-white text-[12.5px] font-medium flex items-center gap-1.5"
          >
            <ExternalLink className="w-3.5 h-3.5" strokeWidth={1.8} />
            Authorize GitLab
          </button>
        )}
      </div>
    </Modal>
  )
}
