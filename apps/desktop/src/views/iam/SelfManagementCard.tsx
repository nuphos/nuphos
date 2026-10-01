import clsx from 'clsx'
import { Eye, EyeOff, KeyRound, Lock, ShieldCheck } from 'lucide-react'

import type { SelfCapabilities } from '../../types'

export function SelfManagementCard({
  capabilities,
  title = 'Self-management',
  readTitle,
  writeTitle,
  readSubtitle = 'Self-introspection',
  writeSubtitle = 'Self-modification',
}: {
  capabilities: SelfCapabilities
  title?: string
  readTitle?: string
  writeTitle?: string
  readSubtitle?: string
  writeSubtitle?: string
}) {
  // Convention (customer perspective):
  //   canRead = true  → green (good: the page can show what's granted)
  //   canRead = false → amber (caution: page will be incomplete)
  //   canWrite = true → green (good: you can update what Nuphos can do
  //                     without re-binding the account)
  //   canWrite = false → neutral (informational: you'd need higher-level
  //                      access elsewhere to change the permissions)
  return (
    <section className="px-6 py-4 border-t border-zGray-800/60">
      <div className="flex items-center gap-2 mb-3">
        <KeyRound className="w-4 h-4 text-zViolet-accent" strokeWidth={1.8} />
        <h2 className="text-[13px] font-semibold text-main">{title}</h2>
        {capabilities.inferred && (
          <span
            className="ml-auto text-[10.5px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded bg-warning/15 text-warning"
            title="We couldn't run an authoritative check (e.g. AWS iam:SimulatePrincipalPolicy was denied) and fell back to inferring from the policy documents."
          >
            Inferred
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 @lg:grid-cols-2 gap-2.5">
        <CapabilityRow
          tone={capabilities.canRead ? 'good' : 'caution'}
          icon={capabilities.canRead ? Eye : EyeOff}
          badge={capabilities.canRead ? null : 'INCOMPLETE'}
          title={
            readTitle ??
            (capabilities.canRead
              ? 'Can read its own permissions'
              : 'Cannot read its own permissions')
          }
          subtitle={readSubtitle}
          detail={capabilities.readReason}
        />
        <CapabilityRow
          tone={capabilities.canWrite ? 'good' : 'neutral'}
          icon={capabilities.canWrite ? ShieldCheck : Lock}
          badge={null}
          title={
            writeTitle ??
            (capabilities.canWrite
              ? 'Can modify its own permissions'
              : 'Cannot modify its own permissions')
          }
          subtitle={writeSubtitle}
          detail={capabilities.writeReason}
        />
      </div>
    </section>
  )
}

function CapabilityRow({
  tone,
  icon: Icon,
  badge,
  title,
  subtitle,
  detail,
}: {
  tone: 'good' | 'caution' | 'neutral'
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  badge: string | null
  title: string
  subtitle: string
  detail: string
}) {
  const palette = {
    good: {
      border: 'border-success/40',
      bg: 'bg-success/5',
      iconWrap: 'bg-success/20 text-success',
      iconStroke: 1.8,
      label: 'text-success font-semibold',
      badge: 'bg-success/15 text-success',
    },
    caution: {
      border: 'border-warning/60',
      bg: 'bg-warning/10',
      iconWrap: 'bg-warning/25 text-warning',
      iconStroke: 1.8,
      label: 'text-warning font-semibold',
      badge: 'bg-warning/20 text-warning',
    },
    neutral: {
      border: 'border-zGray-800',
      bg: 'bg-zGray-950',
      iconWrap: 'bg-zGray-850 text-tertiary',
      iconStroke: 1.8,
      label: 'text-main font-medium',
      badge: 'bg-zGray-850 text-tertiary',
    },
  }[tone]

  return (
    <div
      className={clsx('border-l-2 px-3 py-2.5 flex gap-2.5 relative', palette.border, palette.bg)}
    >
      <div
        className={clsx(
          'flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center',
          palette.iconWrap,
        )}
      >
        <Icon className="w-4 h-4" strokeWidth={palette.iconStroke} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={clsx('text-[12.5px]', palette.label)}>{title}</span>
          {badge && (
            <span
              className={clsx(
                'text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded',
                palette.badge,
              )}
            >
              {badge}
            </span>
          )}
        </div>
        <div className="text-[10.5px] uppercase tracking-wider text-tertiary mt-0.5">
          {subtitle}
        </div>
        <div className="text-[11.5px] text-secondary leading-relaxed mt-1">{detail}</div>
      </div>
    </div>
  )
}
