import clsx from 'clsx'
import { AlertTriangle, ShieldCheck } from 'lucide-react'

import { CloudLogo } from '../../components/CloudLogo'

// Explains what a permission-admin role/SA is, shown at the top of its detail
// view (it replaces the self-management card, which isn't meaningful here).
export function RetiredBindingNotice({ principal }: { principal: 'role' | 'service account' }) {
  return (
    <section className="px-6 py-4">
      <div className="flex items-start gap-2.5 p-3 rounded-md border border-zViolet-500/30 bg-zViolet-500/10">
        <ShieldCheck
          className="w-4 h-4 text-zViolet-accent flex-shrink-0 mt-0.5"
          strokeWidth={1.8}
        />
        <div className="text-[12px] text-secondary leading-relaxed">
          This legacy {principal} connection is retired and cannot be used by the agent. Remove it
          and connect a regular {principal} if you need access to this cloud account.
        </div>
      </div>
    </section>
  )
}

export function EmptyHint({ message }: { message: string }) {
  return (
    <div className="border-y border-zGray-800 bg-zGray-950 py-3 text-[12px] text-tertiary leading-relaxed">
      {message}
    </div>
  )
}

export function EffectivePermissions({
  permissions,
  serviceAccountEmail,
}: {
  permissions: string[]
  serviceAccountEmail: string
}) {
  if (permissions.length === 0) {
    return (
      <EmptyHint
        message={`Couldn't list IAM bindings (typically because ${serviceAccountEmail} lacks resourcemanager.projects.getIamPolicy), and the SA has none of the permissions Nuphos probes for. Effectively read-denied — grant the connector roles and refresh.`}
      />
    )
  }

  return (
    <div className="rounded-md border border-zGray-800 bg-zGray-950 px-3 py-3 space-y-2">
      <div className="text-[11.5px] text-tertiary leading-relaxed">
        Couldn't read this project's IAM policy (the SA lacks{' '}
        <span className="font-mono">resourcemanager.projects.getIamPolicy</span>). Probed{' '}
        {permissions.length} permission{permissions.length === 1 ? '' : 's'} that the SA does have —
        granted to {serviceAccountEmail}.
      </div>
      <div className="flex flex-wrap gap-1">
        {permissions.map((p) => (
          <span
            key={p}
            className="text-[10.5px] font-mono px-1.5 py-0.5 rounded bg-zGray-900 text-secondary border border-zGray-850"
          >
            {p}
          </span>
        ))}
      </div>
    </div>
  )
}

// Sits inside the granted-roles section: the roles listed above are real, but
// they don't add up to something the binding is expected to do. Each entry ends
// with the command that fixes it.
export function BindingWarnings({ warnings }: { warnings?: string[] }) {
  if (!warnings || warnings.length === 0) return null

  return (
    <div className="mb-3 space-y-2">
      {warnings.map((w, idx) => (
        <div
          key={idx}
          role="status"
          className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[12px] text-warning"
        >
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" strokeWidth={2} />
          <span className="min-w-0 break-words leading-relaxed">{w}</span>
        </div>
      ))}
    </div>
  )
}

export function Warnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null

  return (
    <div className="px-6 py-3 border-t border-warning/30 bg-warning/10">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" strokeWidth={1.8} />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] text-warning font-semibold mb-1">Partial result</div>
          <ul className="text-[11.5px] text-secondary leading-relaxed space-y-0.5">
            {warnings.map((w, idx) => (
              <li key={idx} className="font-mono break-words">
                {w}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

export function ProviderSummaryCard({
  provider,
  title,
  subtitle,
  rows,
  actions,
  pinned = false,
}: {
  provider: 'aws' | 'gcp' | 'cloudflare'
  title: string
  subtitle?: string
  rows: { label: string; value: string; mono?: boolean; status?: 'success' | 'error' }[]
  actions?: React.ReactNode
  pinned?: boolean
}) {
  return (
    <section
      className={clsx(
        'px-6 py-4',
        pinned && 'flex-shrink-0 border-b border-zGray-800/60 bg-zGray-950/80 pr-14',
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex items-center gap-3">
          <CloudLogo provider={provider} size={20} />
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-main truncate">{title}</div>
            {subtitle && (
              <div className="text-[11px] text-tertiary font-mono truncate">{subtitle}</div>
            )}
          </div>
        </div>
        {actions && <div className="flex-shrink-0">{actions}</div>}
      </div>
      <div className="grid grid-cols-1 @sm:grid-cols-3 gap-2.5">
        {rows.map((r) => (
          <div key={r.label} className="min-w-0">
            <div className="text-[10.5px] uppercase tracking-wider text-tertiary font-medium mb-0.5">
              {r.label}
            </div>
            <div
              className={clsx(
                'text-[12px] truncate',
                r.mono && 'font-mono',
                r.status === 'success'
                  ? 'text-success'
                  : r.status === 'error'
                    ? 'text-error'
                    : 'text-main',
              )}
              title={r.value}
            >
              {r.value}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
