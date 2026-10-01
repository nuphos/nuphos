import { faTrash } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

import type { LarkUserMapping, TeamMember } from '../../types'

export function LarkLinkedAccountsCard({
  loading,
  userMappings,
  memberById,
  busyKey,
  onDelete,
}: {
  loading: boolean
  userMappings: LarkUserMapping[]
  memberById: Map<string, TeamMember>
  busyKey: string | null
  onDelete: (mapping: LarkUserMapping) => Promise<void>
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-zGray-800/70 bg-surface">
      <div className="border-b border-zGray-800/60 px-4 py-3">
        <div className="text-[13px] font-medium text-main">Linked accounts</div>
        <div className="mt-0.5 text-[12px] text-tertiary">
          Lark users mapped to Nuphos members. Members link themselves by DMing the bot a pairing
          code; remove one to revoke its access.
        </div>
      </div>
      {loading ? (
        <div className="px-4 py-6 text-[13px] text-tertiary">Loading…</div>
      ) : userMappings.length === 0 ? (
        <div className="px-4 py-6 text-[13px] text-tertiary">No accounts linked yet.</div>
      ) : (
        <div className="divide-y divide-zGray-800/60">
          {userMappings.map((mapping) => {
            const member = memberById.get(mapping.nuphosUserId)

            return (
              <div key={mapping.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-main truncate">
                    {member ? member.name || member.email : mapping.nuphosUserId}
                  </div>
                  <div className="flex items-center gap-1.5 font-mono text-[11.5px] text-tertiary truncate">
                    {mapping.larkOpenId}
                    {mapping.createdBy === 'pair-code' && (
                      <span className="rounded border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 font-sans text-[11px] text-emerald-300">
                        self-linked
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void onDelete(mapping)}
                  disabled={busyKey === `user:${mapping.id}`}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-red-500/10 hover:text-error disabled:opacity-50"
                  title="Remove mapping"
                  aria-label="Remove linked account"
                >
                  <FontAwesomeIcon icon={faTrash} className="h-3 w-3" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
