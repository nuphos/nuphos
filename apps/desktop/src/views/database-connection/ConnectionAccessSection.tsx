import { ShieldCheck } from 'lucide-react'

import { SectionHeader } from '../../components/SectionHeader'
import { AppSelect } from '../../components/ui/select'
import { AGENT_POLICY_OPTIONS } from '../../lib/databaseRelease'

import type { DatabaseAgentPolicy, DatabaseConnection, TeamMember } from '../../types'

export function ConnectionAccessSection({
  connection,
  members,
  currentUserId,
  isTeamAdmin,
  busy,
  onUpdateMemberAccess,
  onUpdatePolicy,
}: {
  connection: DatabaseConnection
  members: TeamMember[]
  currentUserId: string
  isTeamAdmin: boolean
  busy: boolean
  onUpdateMemberAccess: (memberAllowList: string[]) => void
  onUpdatePolicy: (policy: DatabaseAgentPolicy) => void
}) {
  return (
    <section className="px-6 py-4">
      <SectionHeader
        icon={<ShieldCheck className="h-4 w-4 text-zViolet-accent" strokeWidth={1.8} />}
        title="Access policy"
        hint="Who — and which agents — may use this connection"
      />
      <div className="max-w-xl">
        <div className="text-[12px] text-secondary">Member access</div>
        <div className="mt-1 flex rounded-md border border-zGray-800 bg-zGray-900 p-0.5">
          <button
            type="button"
            disabled={!isTeamAdmin || busy || !connection.access}
            onClick={() => onUpdateMemberAccess(['*'])}
            className={`flex-1 rounded px-2 py-1 text-[11.5px] ${connection.access?.memberAllowList.includes('*') ? 'bg-zViolet-500 text-white' : 'text-tertiary hover:text-main'} disabled:opacity-50`}
          >
            All team members
          </button>
          <button
            type="button"
            disabled={!isTeamAdmin || busy || !connection.access}
            onClick={() =>
              onUpdateMemberAccess(
                connection.access?.memberAllowList.includes('*')
                  ? [currentUserId]
                  : (connection.access?.memberAllowList ?? [currentUserId]),
              )
            }
            className={`flex-1 rounded px-2 py-1 text-[11.5px] ${connection.access && !connection.access.memberAllowList.includes('*') ? 'bg-zGray-700 text-main' : 'text-tertiary hover:text-main'} disabled:opacity-50`}
          >
            Specific members
          </button>
        </div>
        {connection.access && !connection.access.memberAllowList.includes('*') && (
          <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-md border border-zGray-800 p-2">
            {members.map((member) => {
              const checked = connection.access!.memberAllowList.includes(member.id)

              return (
                <label
                  key={member.id}
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-[11.5px] text-secondary hover:bg-zGray-800/50"
                >
                  <input
                    type="checkbox"
                    disabled={!isTeamAdmin || busy}
                    checked={checked}
                    onChange={() =>
                      onUpdateMemberAccess(
                        checked
                          ? connection.access!.memberAllowList.filter((id) => id !== member.id)
                          : [...connection.access!.memberAllowList, member.id],
                      )
                    }
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {member.name || member.username || member.email}
                  </span>
                  <span className="text-[9.5px] text-tertiary">{member.role.toLowerCase()}</span>
                </label>
              )
            })}
            {members.length === 0 && (
              <div className="py-3 text-center text-[11px] text-tertiary">
                No team members loaded.
              </div>
            )}
          </div>
        )}
        <label className="mt-4 block text-[12px] text-secondary">
          Agent access
          <div className="mt-1">
            <AppSelect
              value={connection.agentPolicy}
              onValueChange={(value) => onUpdatePolicy(value as DatabaseAgentPolicy)}
              disabled={!isTeamAdmin || busy || !connection.access}
              ariaLabel="Agent access policy"
              triggerClassName="h-8 w-full border-zGray-800 bg-field px-2.5 text-[12.5px]"
              options={
                connection.providerOrigin?.capabilities.query === false
                  ? AGENT_POLICY_OPTIONS.filter((o) => o.value !== 'read-only')
                  : AGENT_POLICY_OPTIONS
              }
            />
          </div>
        </label>
        <div className="mt-2 rounded-md border border-zGray-800 bg-zGray-900/55 p-2.5 text-[10.5px] leading-4 text-tertiary">
          {connection.agentPolicy === 'disabled'
            ? 'Agent tools cannot discover or access this database.'
            : connection.providerOrigin
              ? 'Agent tools can discover this provider resource and its supported metadata. Query and change tools remain unavailable unless the provider adapter explicitly exposes those capabilities.'
              : connection.agentPolicy === 'metadata-only'
                ? 'Agent tools can discover metadata and propose governed change Plans, but query execution is rejected.'
                : 'Agent tools can inspect metadata, run bounded read-only queries, and propose governed change Plans. Mutations still require Plan approval and explicit execution.'}
        </div>
        <div className="mt-3 flex gap-2 text-[11.5px] text-tertiary">
          <ShieldCheck className="h-4 w-4 shrink-0 text-success" />
          {connection.providerOrigin
            ? 'Provider credentials are resolved from the active connector only inside backend operations and never copied into prompts, sandboxes, or this database resource.'
            : 'Credentials are decrypted only inside backend operations and are never placed in prompts or sandboxes. Agent queries appear in Audit with source “agent”.'}
        </div>
      </div>
    </section>
  )
}
