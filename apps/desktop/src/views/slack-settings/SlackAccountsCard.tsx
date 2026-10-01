import { Avatar } from '../../components/Avatar'

import type { SlackUserMapping, TeamMember } from '../../types'

export function SlackAccountsCard({
  loading,
  myMapping,
  linkedAccountRows,
  memberById,
  currentUserId,
  canManage,
}: {
  loading: boolean
  myMapping: SlackUserMapping | null
  linkedAccountRows: SlackUserMapping[]
  memberById: Map<string, TeamMember>
  currentUserId: string
  canManage: boolean
}) {
  return (
    <div className="mb-8 overflow-hidden rounded-lg border border-zGray-800/70 bg-surface">
      <div className="border-b border-zGray-800/60 px-4 py-3">
        <div className="text-[13px] font-medium text-main">Slack accounts</div>
        <div className="mt-0.5 text-[12px] text-tertiary">
          Which Nuphos user the agent acts as when someone @mentions it. Usually auto-linked by
          email on install.
        </div>
      </div>
      {!loading && !myMapping && (
        <div className="border-b border-zGray-800/60 px-4 py-3 text-[12.5px] text-tertiary">
          Your Slack account is not linked yet — it links automatically when your Slack email
          matches your Nuphos account email.
        </div>
      )}
      {loading ? (
        <div className="px-4 py-6 text-[13px] text-tertiary">Loading…</div>
      ) : linkedAccountRows.length === 0 ? (
        myMapping ? null : canManage ? (
          <div className="px-4 py-6 text-[13px] text-tertiary">
            No Slack accounts linked on this team yet.
          </div>
        ) : null
      ) : (
        <div className="divide-y divide-zGray-800/60">
          {linkedAccountRows.map((mapping) => {
            const member = memberById.get(mapping.nuphosUserId)
            const isSelf = mapping.nuphosUserId === currentUserId

            return (
              <div key={mapping.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar
                  src={member?.avatarURL}
                  name={member?.name || member?.email || '?'}
                  size={28}
                  className="rounded-full"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[13px] text-main">
                    <span className="truncate">
                      {member ? member.name || member.email : mapping.nuphosUserId}
                    </span>
                    {isSelf && (
                      <span className="flex-shrink-0 rounded border border-zGray-700 px-1.5 py-0.5 text-[11px] text-tertiary">
                        you
                      </span>
                    )}
                    {mapping.slackUser?.matchMethod === 'email' && (
                      <span className="flex-shrink-0 rounded border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-300">
                        matched by email
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[12px] text-tertiary">{member?.email ?? ''}</div>
                </div>
                <div className="flex-shrink-0 text-right">
                  <div className="text-[12.5px] text-secondary">
                    {mapping.slackUser?.displayName ? `@${mapping.slackUser.displayName}` : '—'}
                  </div>
                  <div className="font-mono text-[11.5px] text-tertiary">{mapping.slackUserId}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
