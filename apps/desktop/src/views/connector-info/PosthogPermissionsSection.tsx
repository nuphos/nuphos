import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { useState } from 'react'

import { grantNotices, POSTHOG_ACCESS_LABELS } from '../../lib/posthogPermissions'
import { BindPosthogDialog } from '../BindPosthogDialog'
import { usePosthogScopeCatalog } from '../usePosthogScopeCatalog'

import type { PosthogAccess, PosthogIntegration } from '../../types'

function levelClass(level: PosthogAccess, writeWarning: string | null): string {
  if (level === 'none') return 'text-tertiary'

  return level === 'write' && writeWarning ? 'text-warning' : 'text-secondary'
}

export function PosthogPermissionsSection({
  teamId,
  integration,
  onChanged,
}: {
  teamId: string
  integration: PosthogIntegration
  onChanged: () => void
}) {
  const catalog = usePosthogScopeCatalog(teamId)
  const [editing, setEditing] = useState(false)
  const notices = grantNotices(integration)
  const resources =
    catalog?.resources ??
    Object.keys(integration.permissions).map((id) => ({ id, label: id, writeWarning: null }))

  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-[12.5px] font-medium text-main">Permissions</h3>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-secondary hover:bg-zGray-850 hover:text-main"
        >
          <ShieldCheck className="h-3 w-3" strokeWidth={1.9} />
          Edit permissions
        </button>
      </div>
      {notices.map((notice) => (
        <div
          key={notice.kind}
          className="mb-2 flex items-start gap-1.5 rounded-md border border-zGray-800 px-3 py-2 text-[11.5px] text-warning"
        >
          <AlertTriangle className="mt-px h-3.5 w-3.5 flex-shrink-0" />
          <span className="font-mono break-all">{notice.text}</span>
        </div>
      ))}
      <div className="overflow-hidden rounded-lg border border-zGray-800">
        {resources.map((resource, index) => {
          const level = integration.permissions[resource.id] ?? 'none'

          return (
            <div
              key={resource.id}
              className={`flex items-center gap-3 px-4 py-2 ${
                index > 0 ? 'border-t border-zGray-800/60' : ''
              }`}
            >
              <div className="min-w-0 flex-1 truncate text-[12.5px] text-main">
                {resource.label}
              </div>
              <span className={`text-[11.5px] ${levelClass(level, resource.writeWarning)}`}>
                {POSTHOG_ACCESS_LABELS[level]}
              </span>
            </div>
          )
        })}
      </div>
      {editing && (
        <BindPosthogDialog
          teamId={teamId}
          mode={{ kind: 'permissions', integration }}
          onClose={() => setEditing(false)}
          onBound={() => {
            setEditing(false)
            onChanged()
          }}
        />
      )}
    </section>
  )
}
