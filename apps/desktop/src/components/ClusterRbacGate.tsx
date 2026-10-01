import { ShieldAlert, Copy, ExternalLink, PlugZap, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../api'

import { Button } from './ui/button'
import { toast } from './ui/toast'

/**
 * Shown when the API server never answered. Distinct from the RBAC mask: there
 * the cluster rejected us, here nothing came back at all — almost always a
 * network reachability problem in front of the API server (a public-endpoint IP
 * allowlist, a VPN that is off, or a private-only endpoint).
 */
export function ClusterUnreachableNotice({
  provider,
  onRetry,
}: {
  provider: string
  onRetry: () => void | Promise<void>
}) {
  const [retrying, setRetrying] = useState(false)
  const isTencent = provider === 'tencent-account'

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
      <PlugZap className="mb-3 h-8 w-8 text-warning" strokeWidth={1.6} />
      <div className="mb-2 text-[14px] font-medium text-main">
        Can&apos;t reach this cluster&apos;s API server
      </div>
      <div className="mb-4 max-w-lg text-[12px] text-secondary">
        The credential was issued successfully, but requests to the Kubernetes API get no response —
        so the endpoint is unreachable from this machine rather than rejecting us.
      </div>
      <div className="mb-5 max-w-lg text-[11px] text-tertiary">
        Common causes:
        <ul className="mt-2 list-inside list-disc space-y-1 text-left">
          {isTencent && (
            <li>
              The TKE cluster&apos;s public endpoint has a CIDR allowlist that doesn&apos;t include
              your current IP — add it under{' '}
              <span className="text-secondary">Cluster → Basic Information → Public Access</span>.
            </li>
          )}
          <li>
            A VPN or corporate network is required to reach the endpoint, and it isn&apos;t
            connected.
          </li>
          <li>Your egress IP changed since the allowlist was configured.</li>
        </ul>
      </div>
      <Button
        size="sm"
        variant="secondary"
        disabled={retrying}
        onClick={() => {
          setRetrying(true)
          void Promise.resolve(onRetry())
            .catch((e: unknown) => {
              toast.apiError('Retry failed', e)
            })
            .finally(() => {
              setRetrying(false)
            })
        }}
      >
        <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
        {retrying ? 'Retrying…' : 'Retry'}
      </Button>
    </div>
  )
}

function volcengineAuthorizationUrl(region: string | undefined): string {
  return region
    ? `https://console.volcengine.com/vke/region:vke+${region}/roleAuthorization`
    : 'https://console.volcengine.com/vke'
}

export function ClusterRbacNotice({
  provider,
  teamId,
  accountId,
  region,
  subject,
  onRetry,
}: {
  /** Scope parentKind, e.g. 'volcengine-account' — picks the provider-specific guidance. */
  provider: string
  teamId: string
  accountId?: string
  region?: string
  subject: string | null
  onRetry: () => void | Promise<void>
}) {
  const isVolcengine = provider === 'volcengine-account'
  const isTencent = provider === 'tencent-account'
  const [roleName, setRoleName] = useState<string | null>(null)
  const [rechecking, setRechecking] = useState(false)

  // The provider consoles pick roles by their IAM role NAME (not the TRN/ARN
  // and not the k8s username from the 403, which is an opaque id) — recover it
  // from the bound account's role identifier.
  useEffect(() => {
    if (!accountId) return
    const lookup = isVolcengine
      ? // trn:iam::<account>:role/<name>
        api.atlasListVolcengineAccounts(teamId).then((accounts) =>
          accounts
            .find((a) => a.id === accountId)
            ?.roleTrn?.split('/')
            .pop(),
        )
      : isTencent
        ? // qcs::cam::uin/<uin>:roleName/<name>
          api.atlasListTencentAccounts(teamId).then((accounts) =>
            accounts
              .find((a) => a.id === accountId)
              ?.roleArn?.split('roleName/')
              .pop(),
          )
        : null

    if (!lookup) return
    let alive = true

    lookup
      .then((name) => {
        if (alive && name) setRoleName(name)
      })
      .catch(() => {})

    return () => {
      alive = false
    }
  }, [isVolcengine, isTencent, teamId, accountId])

  const copyRole = async () => {
    const value = roleName ?? subject

    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      toast.success('Copied', value)
    } catch {
      toast.error('Copy failed', 'Could not write to the clipboard')
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
      <ShieldAlert className="mb-3 h-8 w-8 text-warning" strokeWidth={1.6} />
      <div className="mb-2 text-[14px] font-medium text-main">
        Connected, but this cluster hasn&apos;t authorized Nuphos yet
      </div>
      <div className="mb-4 max-w-lg text-[12px] text-secondary">
        Authentication succeeded, but the Kubernetes API rejects every request (403) — the bound
        role has no in-cluster RBAC permission, so nothing in this cluster can be listed. This is
        separate from IAM: it must be granted{' '}
        {isVolcengine ? 'by the cluster creator or the root account' : 'by a cluster administrator'}
        .
      </div>

      {(roleName ?? subject) && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-main bg-surface px-3 py-1.5">
          <span className="text-[11px] text-tertiary">
            {roleName ? 'Role name' : 'Denied identity'}
          </span>
          <code className="text-[12px] text-main selectable">{roleName ?? subject}</code>
          <button
            type="button"
            onClick={() => void copyRole()}
            className="text-tertiary hover:text-main"
            title="Copy"
          >
            <Copy className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        </div>
      )}

      {isVolcengine ? (
        <div className="mb-5 max-w-lg text-[11px] text-tertiary">
          To grant access:
          <ol className="mt-2 list-inside list-decimal space-y-1 text-left">
            <li>
              Open <span className="text-secondary">Role authorization</span> in the VKE console
              (button below) as the cluster creator or root account.
            </li>
            <li>
              Enter the role name
              {roleName ? (
                <>
                  {' '}
                  <span className="text-secondary">{roleName}</span>
                </>
              ) : null}{' '}
              and continue to its authorization page.
            </li>
            <li>
              <span className="text-secondary">Add role authorization</span> — pick this cluster (or
              Account All Resources), a namespace scope, and an access right (e.g. read-only).
            </li>
            <li>Come back here and re-check.</li>
          </ol>
        </div>
      ) : isTencent ? (
        // No console button here: TKE's authorization page lives INSIDE each
        // cluster (per-cluster/region URL), unlike VKE's stable path.
        <div className="mb-5 max-w-lg text-[11px] text-tertiary">
          To grant access:
          <ol className="mt-2 list-inside list-decimal space-y-1 text-left">
            <li>
              Open this cluster in the TKE console →{' '}
              <span className="text-secondary">Authorization Management</span> →{' '}
              <span className="text-secondary">ClusterRoleBinding</span>.
            </li>
            <li>
              <span className="text-secondary">RBAC policy generator</span> → account type{' '}
              <span className="text-secondary">Service role</span> → select the role
              {roleName ? (
                <>
                  {' '}
                  <span className="text-secondary">{roleName}</span>
                </>
              ) : null}
              .
            </li>
            <li>Next — pick the RBAC permissions (read-only is enough for browsing) and apply.</li>
            <li>Come back here and re-check.</li>
          </ol>
        </div>
      ) : (
        <div className="mb-5 max-w-lg text-[11px] text-tertiary">
          Grant the identity above an RBAC (cluster) role binding — e.g. via your provider&apos;s
          console or <code>kubectl create clusterrolebinding</code> run by a cluster admin — then
          re-check.
        </div>
      )}

      <div className="flex items-center gap-2">
        {isVolcengine && (
          <Button
            size="sm"
            onClick={() => void api.appOpenExternal(volcengineAuthorizationUrl(region))}
          >
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />
            Open VKE role authorization
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          disabled={rechecking}
          onClick={() => {
            // The refresh can take a few seconds (it may re-issue the cluster
            // credential); the flag keeps the button from double-firing. The
            // component unmounts as soon as the re-probe passes.
            setRechecking(true)
            void Promise.resolve(onRetry())
              .catch((e: unknown) => {
                toast.apiError('Re-check failed', e)
              })
              .finally(() => {
                setRechecking(false)
              })
          }}
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
          {rechecking ? 'Re-checking…' : "I've granted it — re-check"}
        </Button>
      </div>
    </div>
  )
}
