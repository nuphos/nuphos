import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'

import { useReportVisibleError } from '../../components/VisibleErrorReporter'

import type { GcpRoleDetails } from '../../types'

export function GcpBindingCard({
  role,
  member,
  condition,
  details,
}: {
  role: string
  member: string
  condition?: { title?: string; description?: string; expression?: string }
  details: GcpRoleDetails | undefined
}) {
  const [open, setOpen] = useState(false)

  useReportVisibleError(details?.error, 'gcp_role_permissions_error', open)

  return (
    <div className="rounded-md border border-zGray-800 bg-zGray-950">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-zGray-900"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] text-main truncate font-medium">
            {details?.title || role}
          </div>
          <div className="text-[11px] text-tertiary font-mono truncate">{role}</div>
        </div>
        {role.startsWith('roles/') && !role.includes('/projects/') ? (
          <span className="text-[10.5px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded bg-zGray-800 text-secondary">
            Predefined
          </span>
        ) : (
          <span className="text-[10.5px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded bg-warning/15 text-warning">
            Custom
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-zGray-850 px-3 py-2 space-y-2">
          <div className="text-[11.5px] text-tertiary">
            Granted to <span className="font-mono text-secondary">{member}</span>
          </div>
          {details?.description && (
            <div className="text-[11.5px] text-secondary leading-relaxed">
              {details.description}
            </div>
          )}
          {condition && (
            <div className="text-[11.5px] text-tertiary">
              IAM condition
              {condition.title ? `: ${condition.title}` : ''}
              {condition.expression && (
                <pre className="mt-1 p-2 rounded bg-zGray-900 border border-zGray-800 text-[11px] font-mono text-secondary overflow-x-auto">
                  {condition.expression}
                </pre>
              )}
            </div>
          )}
          {details?.error ? (
            <div className="text-[11.5px] text-error">
              Couldn't read role permissions: {details.error}
            </div>
          ) : details?.includedPermissions.length ? (
            <div>
              <div className="text-[11px] text-tertiary mb-1">
                {details.includedPermissions.length}
                {details.truncated ? '+ permissions (showing first ' : ' permissions ('}
                {details.includedPermissions.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {details.includedPermissions.map((p) => (
                  <span
                    key={p}
                    className="text-[10.5px] font-mono px-1.5 py-0.5 rounded bg-zGray-900 text-secondary border border-zGray-850"
                  >
                    {p}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-[11.5px] text-tertiary italic">
              No permissions listed for this role.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
